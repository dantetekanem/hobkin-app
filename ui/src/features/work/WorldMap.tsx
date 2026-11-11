import { motion } from 'motion/react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JobActivity } from '#shared/protocol/activity.ts'
import { requestCanvasFocus } from '@/app/focus.ts'
import type { RunningAgent } from '@/app/running-agents.ts'
import { useStill } from '@/app/still.ts'
import { useView } from '@/app/view-store.ts'
import { Hob } from '@/avatar/Hob.tsx'
import { useConnection, useHost, type WorkState } from '@/lib/host/index.ts'
import { spring } from '@/lib/motion.ts'
import { sceneFrame } from './world-layout.ts'
import { visitWorldAgent, visitWorldProject, worldFrom } from './world.ts'

/** The entry gate belongs to Work. An already-open world can have one district, or none. */
export function WorldMap({ work, agents, onProject }: { work: WorkState; agents: RunningAgent[]; onProject: (slug: string, discover: boolean) => void }) {
  const runs = useHost(state => state.snapshot.runs)
  const activity = useHost(state => state.snapshot.jobActivity as JobActivity | undefined)
  const home = useHost(state => state.home)
  const epoch = useHost(state => state.epoch)
  const connection = useConnection()
  const sourceIdentity = JSON.stringify([home, epoch])
  const world = useMemo(() => worldFrom({ work, runs: runs ?? [], agents, connection: connection.status, sourceIdentity }), [work, runs, agents, connection.status, sourceIdentity])
  return <Districts key={sourceIdentity} world={world} activity={activity} onProject={onProject} />
}

type PresentedWorld = ReturnType<typeof worldFrom<RunningAgent>>

function Districts({ world, activity, onProject }: { world: PresentedWorld; activity: JobActivity | undefined; onProject: (slug: string, discover: boolean) => void }) {
  const still = useStill()
  const section = useRef<HTMLElement | null>(null)
  const focusedAgent = useRef<string | null>(null)
  const [observed, setObserved] = useState(() => ({ world, activity, still, shown: world, frame: sceneFrame(null, world, activity ?? {}, still) }))
  let current = observed
  if (observed.world !== world || observed.activity !== activity || observed.still !== still) {
    current = { world, activity, still, shown: world.fresh ? world : observed.shown, frame: sceneFrame(observed.frame, world, activity ?? {}, still) }
    setObserved(current)
  }
  const { layout, travel } = current.frame
  const zones = new Map(current.shown.zones.map(zone => [zone.project.slug, zone]))
  const placedAgents = new Map(current.shown.zones.flatMap(zone => zone.agents.map(agent => [agent.id, agent] as const)))
  useLayoutEffect(() => {
    if (!focusedAgent.current || (document.activeElement && document.activeElement !== document.body)) return
    const buttons = [...(section.current?.querySelectorAll<HTMLButtonElement>('[data-world-agent]') ?? [])]
    const target = buttons.find(button => button.dataset.worldAgent === focusedAgent.current) ?? section.current?.querySelector<HTMLButtonElement>('button')
    target?.focus({ preventScroll: true })
  }, [world])
  const openAgent = (id: string) => visitWorldAgent(world, id, { open: useView.getState().openAgentCanvas, focus: requestCanvasFocus })

  return (
    <section ref={section} onFocus={event => { focusedAgent.current = (event.target as HTMLElement).dataset.worldAgent ?? null }} onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) focusedAgent.current = null }} aria-label="Work world" className="relative">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="eyebrow">Work world · {layout.territories.length} districts</h2><p className="mt-1 text-[12px] text-muted-foreground">Priority begins at the top. Open a project for its controls.</p></div>
        <p role="status" className="text-[12px] text-muted-foreground">{world.fresh ? 'Connected · current assignments' : world.connection === 'sample' ? 'Sample projects · no live assignments' : `${world.connection === 'connecting' ? 'Connecting' : 'Offline'} · stale, last-known assignments`}</p>
      </header>
      <p className="mb-3 text-[11px] text-muted-foreground">Assignment/activity diagram, not physical location. Travel reflects observed assignment or activity changes.</p>
      {!layout.territories.length ? <p className="py-12 text-center text-muted-foreground">No chosen projects remain in this world.</p> : (
        <div role="region" aria-label="Spatial project map; scroll to explore" tabIndex={0} className="max-h-[70vh] overflow-auto rounded-3xl bg-surface outline-offset-2">
          <div className="relative isolate" style={{ width: layout.width, height: layout.height }}>
            <svg aria-hidden="true" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} className="pointer-events-none absolute inset-0">
              <path d={`M 24 16 H 696 V ${layout.height - 16} H 24 Z`} fill="var(--hb-surface-2, var(--hb-surface))" />
              {layout.territories.map((territory, index) => <polygon key={territory.slug} points={territory.points.map(point => `${point.x},${point.y}`).join(' ')} fill={index % 2 ? 'var(--hb-surface)' : 'var(--hb-tone-1, var(--hb-surface-2))'} stroke="var(--hb-border-strong)" strokeWidth={1.5} />)}
              <path d={`M 48 24 ${layout.territories.map(t => `Q 30 ${t.label.y + 70} 48 ${t.bottom[0]!.y}`).join(' ')} L 48 ${layout.height - 24}`} fill="none" stroke="var(--hb-muted)" strokeOpacity={0.35} strokeWidth={3} strokeDasharray="3 9" />
            </svg>
            {layout.territories.map(territory => {
              const zone = zones.get(territory.slug)
              if (!zone) return null
              return <div key={territory.slug} className="absolute" style={{ left: territory.label.x, top: territory.label.y, width: 580 }}>
                <button type="button" data-stop="" onClick={() => visitWorldProject(world, territory.slug, onProject)} title={zone.facts.join(' · ')} className="block max-w-full rounded-md px-1 py-1 text-left outline-offset-2 hover:bg-tone-1 focus-visible:bg-surface-2">
                  <span className="block truncate font-heading text-[18px] font-semibold">{zone.project.name} <span className="ml-2 font-mono text-[11px] text-muted-foreground">{zone.project.priority}{zone.project.paused ? ' · paused' : ''}</span></span>
                  <span className="block truncate font-mono text-[10px] text-muted-foreground">{territory.slug}</span>
                </button>
                {!zone.agents.length ? <p className="mt-8 text-[12px] text-muted-foreground">{world.fresh ? 'No agent running' : 'No agent in this snapshot'}</p> : null}
              </div>
            })}
            {layout.agents.map(place => {
              const agent = placedAgents.get(place.id)
              if (!agent) return null
              return <motion.button key={place.id} type="button" data-stop="" data-world-agent={place.id} onClick={() => openAgent(place.id)} aria-label={`${agent.title}. ${place.slug}. ${agent.doing}. Opens its canvas.`} title={`${agent.title} · ${agent.doing}`} className="absolute left-0 top-0 flex items-center gap-2 rounded-xl p-1 text-left outline-offset-2 hover:bg-tone-1 focus-visible:bg-surface-2" style={{ width: 160, height: 72 }} initial={false} animate={{ transform: `translate(${place.x}px, ${place.y}px)` }} transition={travel.includes(place.id) && !still && world.fresh ? spring.travel : { duration: 0 }}>
                <span aria-hidden="true" className="shrink-0"><Hob size={40} still mood={agent.presentation?.mood ?? 'idle'} tint={`oklch(0.62 0.11 ${agent.presentation?.hue ?? 80})`} /></span>
                <span className="min-w-0 text-[11px]"><span className="line-clamp-2 font-medium">{agent.title}</span><span className="mt-0.5 block truncate text-muted-foreground">{agent.doing}</span></span>
              </motion.button>
            })}
          </div>
        </div>
      )}
      <p className="mt-4 text-[11px] text-muted-foreground">Empty districts have no assigned running root agent. Assessment and nested-agent activity are unknown here.</p>
    </section>
  )
}
