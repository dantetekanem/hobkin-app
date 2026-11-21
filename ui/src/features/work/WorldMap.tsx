import { AnimatePresence, motion } from 'motion/react'
import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type ReactNode } from 'react'
import type { JobActivity } from '#shared/protocol/activity.ts'
import { requestCanvasFocus } from '@/app/focus.ts'
import type { RunningAgent } from '@/app/running-agents.ts'
import { useStill } from '@/app/still.ts'
import { useView } from '@/app/view-store.ts'
import { Hob } from '@/avatar/Hob.tsx'
import { useConnection, useHost, useHostKept, type HostState, type WorkState } from '@/lib/host/index.ts'
import { spring, tween } from '@/lib/motion.ts'
import { GLOBE, sameObservations, sceneFrame, type AgentPlace, type Island, type Point, type SceneFrame } from './world-layout.ts'
import { visitWorldAgent, visitWorldProject, worldFrom } from './world.ts'
import './world.css'

type OpenProject = (slug: string, discover: boolean) => void

const jobActivity = (state: HostState) => state.snapshot.jobActivity as JobActivity | undefined
// The globe reads only each agent's newest step and how it stands, so the activity held stays while those do.
const keepObserved = (held: JobActivity | undefined, next: JobActivity | undefined) => (sameObservations(held, next) ? held : next)

interface WorldMapProps {
  work: WorkState
  agents: RunningAgent[]
  onProject: OpenProject
}

/** The entry gate belongs to Work. An already-open world can have one island, or none. */
export function WorldMap({ work, agents, onProject }: WorldMapProps) {
  const runs = useHost((state) => state.snapshot.runs)
  // Not for each word an agent streams: only a new step, or a step that ends, moves it on the globe.
  const activity = useHostKept(jobActivity, keepObserved)
  const home = useHost((state) => state.home)
  const epoch = useHost((state) => state.epoch)
  const connection = useConnection()
  const sourceIdentity = JSON.stringify([home, epoch])

  const world = useMemo(
    () => worldFrom({ work, runs: runs ?? [], agents, connection: connection.status, sourceIdentity }),
    [work, runs, agents, connection.status, sourceIdentity],
  )

  return <Globe key={sourceIdentity} world={world} activity={activity} onProject={onProject} />
}

type PresentedWorld = ReturnType<typeof worldFrom<RunningAgent>>
type Zone = PresentedWorld['zones'][number]
type ZoneAgent = Zone['agents'][number]

const POLE = GLOBE / 2
const SQUARE = `0 0 ${GLOBE} ${GLOBE}`
/** With less room than this to the next island, a name stands alone and the rest waits for the pointer. */
const ROOM_FOR_FACTS = 172
/** How far in each height's contour sits, from the coast towards the peak. */
const HEIGHTS = [0.7, 0.44, 0.22]

/** A length on the globe as a share of the width it is given, so the whole picture grows and shrinks with its room. */
const span = (length: number) => `${((length / GLOBE) * 100).toFixed(3)}cqw`

const plural = (amount: number, one: string, many = `${one}s`) => `${amount} ${amount === 1 ? one : many}`

const hoodColor = (agent: ZoneAgent) => `oklch(0.62 0.11 ${agent.presentation?.hue ?? 80})`

/** Plain soil where nothing has happened yet, the brand's yellow where the most has. */
const landColor = (heat: number) => `color-mix(in oklab, var(--hb-accent) ${Math.round(14 + 86 * heat)}%, var(--world-soil))`

/** The square an island is drawn in: its radius to every side of its centre. */
function plotStyle(island: Island): CSSProperties {
  const side = span(island.radius * 2)
  const left = span(island.x - island.radius)
  const top = span(island.y - island.radius)

  return { width: side, height: side, transform: `translate(${left}, ${top})` }
}

/** A name hangs below the island's southern shore, or stands above its northern one, in the sea its neighbours leave. */
function nameStyle(island: Island): CSSProperties {
  const maxWidth = span(Math.max(130, Math.min(280, island.room * 0.95)))

  if (island.label === 'below') {
    return { top: `calc(50% + ${span(island.south * island.radius)} + 5px)`, maxWidth }
  }
  return { bottom: `calc(50% + ${span(-island.north * island.radius)} + 5px)`, maxWidth }
}

/** A closed curve through the middle of each pair of points, so a coast has no corners. */
function coastline(points: readonly Point[], scale = 1, shift: Point = { x: 0, y: 0 }): string {
  const at = (index: number): Point => {
    const point = points[index % points.length]!
    return { x: point.x * scale + shift.x, y: point.y * scale + shift.y }
  }
  const written = (point: Point) => `${point.x.toFixed(4)} ${point.y.toFixed(4)}`
  const middle = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

  const start = written(middle(at(points.length - 1), at(0)))
  const curves = points.map((_, index) => `Q ${written(at(index))} ${written(middle(at(index), at(index + 1)))}`)
  return `M ${start} ${curves.join(' ')} Z`
}

const islandTarget = (slug: string) => `island:${slug}`
const agentTarget = (id: string) => `agent:${id}`

function connectionLine(world: PresentedWorld): string {
  if (world.fresh) return 'Connected · current assignments'
  if (world.connection === 'sample') return 'Sample projects · no live assignments'

  const state = world.connection === 'connecting' ? 'Connecting' : 'Offline'
  return `${state} · stale, last-known assignments`
}

function workingLine(agents: number, fresh: boolean): string {
  if (!agents) return fresh ? 'no agent running' : 'no agent in this snapshot'
  return `${plural(agents, 'agent')} ${fresh ? 'working now' : 'when last seen'}`
}

/** The end of a meridian: a twelfth of a turn apart, this far from the pole. */
const onMeridian = (twelfth: number, out: number): Point => ({
  x: POLE + out * Math.cos((twelfth * Math.PI) / 6),
  y: POLE + out * Math.sin((twelfth * Math.PI) / 6),
})

const LATITUDES = [125, 250, 375]
const MERIDIANS = Array.from({ length: 12 }, (_, twelfth) => ({ from: onMeridian(twelfth, 40), to: onMeridian(twelfth, POLE) }))
/** Dotted rings that turn about the pole: how far out, their dots, and the seconds one turn takes. Below zero turns the other way. */
const CURRENTS = [
  { ring: 190, dots: '3 30', seconds: 170 },
  { ring: 315, dots: '3 38', seconds: -240 },
  { ring: 440, dots: '3 46', seconds: 320 },
]
const CLOUDS: CSSProperties[] = [
  { left: '8%', top: '20%', width: '38%', height: '13%', rotate: '-28deg' },
  { left: '52%', top: '10%', width: '30%', height: '10%', rotate: '24deg' },
  { left: '56%', top: '64%', width: '36%', height: '12%', rotate: '-38deg' },
  { left: '12%', top: '70%', width: '26%', height: '9%', rotate: '32deg' },
]

/** The sea: the pole, its rings and meridians, and the currents that turn about it. */
const SEA = (
  <div aria-hidden="true" className="world-sea absolute inset-0 overflow-hidden rounded-full">
    <svg viewBox={SQUARE} className="world-grid absolute inset-0 size-full">
      {LATITUDES.map((ring) => (
        <circle key={ring} cx={POLE} cy={POLE} r={ring} />
      ))}
      {MERIDIANS.map(({ from, to }, twelfth) => (
        <line key={twelfth} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
      ))}
      <path d={`M ${POLE - 9} ${POLE} H ${POLE + 9} M ${POLE} ${POLE - 9} V ${POLE + 9}`} />
    </svg>
    {CURRENTS.map(({ ring, dots, seconds }) => (
      <svg
        key={ring}
        viewBox={SQUARE}
        className="world-current absolute inset-0 size-full"
        style={{ animationDuration: `${Math.abs(seconds)}s`, animationDirection: seconds < 0 ? 'reverse' : 'normal' }}
      >
        <circle cx={POLE} cy={POLE} r={ring} strokeDasharray={dots} />
      </svg>
    ))}
  </div>
)

/** The weather that drifts over the land and under the names. */
const WEATHER = (
  <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
    <div className="world-weather">
      {CLOUDS.map((cloud) => (
        <i key={cloud.left} className="world-cloud" style={cloud} />
      ))}
    </div>
  </div>
)

type IslandPictureProps = Pick<Island, 'coast' | 'islets' | 'peak' | 'tiers'> & { waves: boolean }

/** One island's land and the waves off it. Its coast, islets and peak never change, so it is drawn once and only its colour moves. */
const IslandPicture = memo(function IslandPicture({ coast, islets, peak, tiers, waves }: IslandPictureProps) {
  const shore = useMemo(() => coastline(coast), [coast])
  const contours = HEIGHTS.slice(0, tiers).map((height) => {
    const towardsPeak = { x: peak.x * (1 - height), y: peak.y * (1 - height) }
    return coastline(coast, height, towardsPeak)
  })

  return (
    <>
      {waves
        ? [0, 1].map((wave) => (
            <svg key={wave} viewBox="-1 -1 2 2" className="world-ripple size-full overflow-visible">
              <path d={shore} />
            </svg>
          ))
        : null}
      <svg viewBox="-1 -1 2 2" className="world-art absolute inset-0 size-full overflow-visible">
        <path d={shore} transform="scale(1.15)" className="world-shelf" />
        {islets.map((islet, index) => (
          <path key={index} d={coastline(islet.coast, 1, islet)} className="world-land" />
        ))}
        <path d={shore} className="world-land" />
        {contours.map((contour, tier) => (
          <path key={tier} d={contour} className="world-height" data-tier={tier} />
        ))}
      </svg>
    </>
  )
})

interface IslandLandProps {
  island: Island
  /** Its place among the islands, which staggers its arrival and its waves. */
  order: number
  /** An agent is working here now. */
  live: boolean
  paused: boolean
  /** The pointer or the keyboard is on it. */
  active: boolean
  focused: boolean
  still: boolean
  /** The merged count it reached when a merge was seen here, if one was. */
  landing: number | undefined
}

function IslandLand({ island, order, live, paused, active, focused, still, landing }: IslandLandProps) {
  const style = {
    ...plotStyle(island),
    '--world-land': landColor(island.heat),
    '--world-heat': island.heat,
    '--world-wait': `${(order * 1.7) % 9}s`,
    '--world-entry': `${Math.min(order, 10) * 55}ms`,
  } as CSSProperties

  return (
    <div
      aria-hidden="true"
      className="world-island absolute left-0 top-0"
      data-live={live || undefined}
      data-active={active || undefined}
      data-focus={focused || undefined}
      data-paused={paused || undefined}
      style={style}
    >
      <div className="world-rise">
        <IslandPicture coast={island.coast} islets={island.islets} peak={island.peak} tiers={island.tiers} waves={!still} />
        {landing ? <i key={landing} className="world-burst" /> : null}
      </div>
    </div>
  )
}

/** What a control hands the globe so the card follows it: the pointer by these handlers, the keyboard by the target's name. */
interface Pointing {
  'data-world-target': string
  onPointerEnter: () => void
  onPointerLeave: () => void
}

interface IslandButtonProps {
  island: Island
  zone: Zone
  fresh: boolean
  pointing: Pointing
  onOpen: () => void
}

/** The island's control: its whole circle, and its name in the sea beside it. */
function IslandButton({ island, zone, fresh, pointing, onOpen }: IslandButtonProps) {
  const { project } = zone
  const live = fresh && island.workers > 0
  // A host that does not count merged work says nothing of it, which is not the same as none.
  const merged = project.merged === undefined ? null : `${island.merged} merged`
  const working = island.workers ? workingLine(island.workers, fresh) : 'No agent running'
  const spoken = [project.name, merged, working, ...zone.facts, 'Opens the project in Work.'].filter((part) => part !== null).join('. ')

  return (
    <button type="button" data-stop="" {...pointing} onClick={onOpen} aria-label={spoken} className="absolute left-0 top-0 rounded-full outline-none" style={plotStyle(island)}>
      <span className="world-name" style={nameStyle(island)}>
        <span className="block truncate font-heading text-[13px] font-semibold leading-[1.25]">{project.name}</span>
        {island.room >= ROOM_FOR_FACTS ? (
          <span className="block truncate font-mono text-[10px] leading-[1.35] text-muted-foreground">
            {[project.priority, project.paused ? 'paused' : null, merged].filter((part) => part !== null).join(' · ')}
          </span>
        ) : null}
        {live ? <span className="world-working font-mono text-[10px] leading-[1.35]">{island.workers} working</span> : null}
      </span>
    </button>
  )
}

interface WorkerProps {
  place: AgentPlace
  agent: ZoneAgent
  /** The host vouches for it now, so it moves as it works. */
  live: boolean
  still: boolean
  /** It crosses to its new place, for a move that was seen. Otherwise it is simply there. */
  travels: boolean
  pointing: Pointing
  onOpen: () => void
}

/** An agent, standing on its island. */
function Worker({ place, agent, live, still, travels, pointing, onOpen }: WorkerProps) {
  const left = span(place.x - place.size / 2)
  const top = span(place.y - place.size / 2)

  return (
    <motion.button
      type="button"
      data-stop=""
      data-world-agent={place.id}
      {...pointing}
      data-live={live || undefined}
      onClick={onOpen}
      aria-label={`${agent.title}. ${place.slug}. ${agent.doing}. Opens its canvas.`}
      className="world-worker absolute left-0 top-0 grid place-items-center rounded-full outline-none"
      style={{ width: span(place.size), height: span(place.size) }}
      initial={false}
      animate={{ transform: `translate(${left}, ${top})` }}
      transition={travels ? spring.travel : { duration: 0 }}
    >
      <Hob size={40} className="size-[118%]" still={still || !live} mood={agent.presentation?.mood ?? 'idle'} tint={hoodColor(agent)} stage="var(--hb-surface)" />
    </motion.button>
  )
}

interface CardProps {
  /** The middle of what the card is about, and how far that reaches to each side. */
  at: Point
  half: number
  still: boolean
  children: ReactNode
}

/** What the pointer or the keyboard is on, beside it, on the side with more of the globe. The control's own label says the same aloud. */
function Card({ at, half, still, children }: CardProps) {
  const toTheEast = at.x < POLE
  const side = toTheEast ? { left: `calc(${span(at.x + half)} + 12px)` } : { right: `calc(${span(GLOBE - at.x + half)} + 12px)` }

  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none absolute z-30 w-64 -translate-y-1/2 rounded-[14px] border border-border bg-popover p-3 text-popover-foreground shadow-float"
      style={{ top: span(at.y), transformOrigin: toTheEast ? 'left center' : 'right center', ...side }}
      initial={still ? false : { opacity: 0, transform: 'scale(0.96)' }}
      animate={{ opacity: 1, transform: 'scale(1)' }}
      exit={{ opacity: 0, transition: still ? { duration: 0 } : tween.exit }}
      transition={still ? { duration: 0 } : tween.enter}
    >
      {children}
    </motion.div>
  )
}

function IslandFacts({ zone, fresh }: { zone: Zone; fresh: boolean }) {
  const { project, agents } = zone
  const merged = project.merged === undefined ? 'Not known' : plural(project.merged, 'change')
  const working = agents.length ? plural(agents.length, 'agent') : fresh ? 'No agent running' : 'No agent in this snapshot'
  const open = [
    project.open ? `${project.open} to do` : null,
    project.prs ? plural(project.prs, 'PR') : null,
    project.branches ? plural(project.branches, 'branch', 'branches') : null,
  ].filter((part) => part !== null)

  return (
    <>
      <p className="flex items-baseline justify-between gap-3">
        <span className="truncate font-heading text-[14px] font-semibold">{project.name}</span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {project.priority}
          {project.paused ? ' · paused' : ''}
        </span>
      </p>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px] [&_dt]:text-muted-foreground">
        <dt>Merged</dt>
        <dd>{merged}</dd>
        <dt>{fresh ? 'Working now' : 'Last seen working'}</dt>
        <dd>{working}</dd>
        <dt>Open</dt>
        <dd>{open.join(' · ') || 'Nothing'}</dd>
        {project.left ? (
          <>
            <dt>Waiting for you</dt>
            <dd>{plural(project.left, 'step')}</dd>
          </>
        ) : null}
      </dl>
      {agents.length ? (
        <ul className="mt-2 flex flex-col gap-1.5 border-t border-border pt-2 text-[12px]">
          {agents.map((agent) => (
            <li key={agent.id} className="flex items-start gap-2">
              <i className="world-dot" style={{ background: hoodColor(agent) }} />
              <span className="min-w-0">
                <span className="line-clamp-1 font-medium">{agent.title}</span>
                <span className="line-clamp-1 text-muted-foreground">{agent.doing}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {project.lookError ? <p className="mt-2 text-[11px] text-bad-fg">Last look failed: {project.lookError}</p> : null}
    </>
  )
}

function AgentFacts({ agent, slug }: { agent: ZoneAgent; slug: string }) {
  return (
    <>
      <p className="line-clamp-2 font-heading text-[13px] font-semibold">{agent.title}</p>
      <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{agent.doing}</p>
      <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">{slug} · opens its canvas</p>
    </>
  )
}

interface Scene {
  world: PresentedWorld
  activity: JobActivity | undefined
  still: boolean
  /** The last world the host vouched for, which stays on screen while it cannot be asked. */
  shown: PresentedWorld
  frame: SceneFrame
  /** The merged count each island reached when a merge was seen here. The count keys its mark, so the next merge marks it again. */
  landings: Readonly<Record<string, number>>
}

function landingsIn(frame: SceneFrame): Record<string, number> {
  const landed = frame.layout.islands.filter((island) => frame.landed.includes(island.slug))
  return Object.fromEntries(landed.map((island) => [island.slug, island.merged]))
}

/** The globe for these inputs, carried on from the one before, so a move or a merge is told once and a stale globe stays as it was. */
function useScene(world: PresentedWorld, activity: JobActivity | undefined, still: boolean): Scene {
  const [scene, setScene] = useState<Scene>(() => ({
    world,
    activity,
    still,
    shown: world,
    frame: sceneFrame(null, world, activity ?? {}, still),
    landings: {},
  }))

  const unchanged = scene.world === world && scene.activity === activity && scene.still === still
  if (unchanged) return scene

  const frame = sceneFrame(scene.frame, world, activity ?? {}, still)
  const next: Scene = {
    world,
    activity,
    still,
    shown: world.fresh ? world : scene.shown,
    frame,
    landings: { ...scene.landings, ...landingsIn(frame) },
  }
  setScene(next)
  return next
}

interface GlobeProps {
  world: PresentedWorld
  activity: JobActivity | undefined
  onProject: OpenProject
}

function Globe({ world, activity, onProject }: GlobeProps) {
  const still = useStill()
  const section = useRef<HTMLElement | null>(null)
  const focusedAgent = useRef<string | null>(null)
  const [pointed, setPointed] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const { shown, frame, landings } = useScene(world, activity, still)

  // Only what both the layout and the world shown know of is drawn: an island with its project, an agent with its place.
  const { layout, travel } = frame
  const zones = new Map(shown.zones.map((zone) => [zone.project.slug, zone]))
  const agentsById = new Map(shown.zones.flatMap((zone) => zone.agents.map((agent) => [agent.id, agent] as const)))
  const charted = layout.islands.flatMap((island) => {
    const zone = zones.get(island.slug)
    return zone ? [{ island, zone }] : []
  })
  const standing = layout.agents.flatMap((place) => {
    const agent = agentsById.get(place.id)
    return agent ? [{ place, agent }] : []
  })

  // The keyboard was on an agent whose control went away: it goes back to that agent if it is drawn again, or to the first control.
  useLayoutEffect(() => {
    const keyboardIsElsewhere = document.activeElement && document.activeElement !== document.body
    if (!focusedAgent.current || keyboardIsElsewhere) return

    const workers = [...(section.current?.querySelectorAll<HTMLButtonElement>('[data-world-agent]') ?? [])]
    const sameWorker = workers.find((worker) => worker.dataset.worldAgent === focusedAgent.current)
    const control = sameWorker ?? section.current?.querySelector<HTMLButtonElement>('button')
    control?.focus({ preventScroll: true })
  }, [world])

  const followFocus = (event: FocusEvent<HTMLElement>) => {
    const control = event.target
    focusedAgent.current = control.dataset.worldAgent ?? null
    setFocused(control.matches(':focus-visible') ? (control.dataset.worldTarget ?? null) : null)
  }
  const releaseFocus = (event: FocusEvent<HTMLElement>) => {
    const leftTheGlobe = event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)
    if (leftTheGlobe) focusedAgent.current = null
    setFocused(null)
  }
  const pointingAt = (target: string): Pointing => ({
    'data-world-target': target,
    onPointerEnter: () => setPointed(target),
    onPointerLeave: () => setPointed(null),
  })
  const openAgent = (id: string) => visitWorldAgent(world, id, { open: useView.getState().openAgentCanvas, focus: requestCanvasFocus })

  const active = pointed ?? focused
  const activeIsland = charted.find(({ island }) => islandTarget(island.slug) === active)
  const activeAgent = standing.find(({ place }) => agentTarget(place.id) === active)
  const mergedIsCounted = charted.some(({ zone }) => zone.project.merged !== undefined)
  const merged = charted.reduce((sum, { island }) => sum + island.merged, 0)
  const totals = mergedIsCounted ? `${plural(merged, 'change')} merged · ${workingLine(standing.length, world.fresh)}` : workingLine(standing.length, world.fresh)
  const stale = world.connection === 'offline' || world.connection === 'connecting'

  return (
    <section ref={section} onFocus={followFocus} onBlur={releaseFocus} aria-label="Work world" className="relative">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="eyebrow">Work world · {plural(charted.length, 'island')}</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">{totals}</p>
        </div>
        <p role="status" className="text-[12px] text-muted-foreground">
          {connectionLine(world)}
        </p>
      </header>

      {charted.length ? (
        <div
          className="world @container relative mx-auto aspect-square w-full max-w-[clamp(420px,calc(100vh_-_300px),780px)]"
          data-still={still || undefined}
          data-stale={stale || undefined}
        >
          {SEA}
          {charted.map(({ island, zone }, order) => (
            <IslandLand
              key={island.slug}
              island={island}
              order={order}
              live={world.fresh && island.workers > 0}
              paused={zone.project.paused}
              active={active === islandTarget(island.slug)}
              focused={focused === islandTarget(island.slug)}
              still={still}
              landing={landings[island.slug]}
            />
          ))}
          {WEATHER}
          {charted.map(({ island, zone }) => (
            <IslandButton
              key={island.slug}
              island={island}
              zone={zone}
              fresh={world.fresh}
              pointing={pointingAt(islandTarget(island.slug))}
              onOpen={() => visitWorldProject(world, island.slug, onProject)}
            />
          ))}
          {standing.map(({ place, agent }) => (
            <Worker
              key={place.id}
              place={place}
              agent={agent}
              live={world.fresh}
              still={still}
              travels={travel.includes(place.id) && !still && world.fresh}
              pointing={pointingAt(agentTarget(place.id))}
              onOpen={() => openAgent(place.id)}
            />
          ))}
          <AnimatePresence>
            {activeIsland ? (
              <Card key={active} at={activeIsland.island} half={activeIsland.island.radius} still={still}>
                <IslandFacts zone={activeIsland.zone} fresh={world.fresh} />
              </Card>
            ) : activeAgent ? (
              <Card key={active} at={activeAgent.place} half={activeAgent.place.size / 2} still={still}>
                <AgentFacts agent={activeAgent.agent} slug={activeAgent.place.slug} />
              </Card>
            ) : null}
          </AnimatePresence>
        </div>
      ) : (
        <p className="py-12 text-center text-muted-foreground">No chosen projects remain in this world.</p>
      )}

      <p className="mx-auto mt-5 max-w-[78ch] text-center text-[11px] leading-relaxed text-muted-foreground">
        Each project is an island, drawn from its name. The more work has landed and is under way there, the stronger its colour and the higher its peaks. Waves
        spread from an island while an agent works on it, and higher priority sits nearer the pole. Agents started by another agent are not drawn.
      </p>
    </section>
  )
}
