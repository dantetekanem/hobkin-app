import { ChevronRight } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { requestCanvasFocus } from '@/app/focus.ts'
import type { RunningAgent } from '@/app/running-agents.ts'
import { useStill } from '@/app/still.ts'
import { useView } from '@/app/view-store.ts'
import { Hob } from '@/avatar/Hob.tsx'
import { AgentHood } from '@/components/Mark.tsx'
import { Button } from '@/components/ui/button.tsx'
import { OpenArrow } from '@/components/ui/open-arrow.tsx'
import { cn } from '@/lib/utils.ts'
import { sameFields, sameLists } from '@/lib/host/frame.ts'
import { hostStore, useHost, useHostEqual } from '@/lib/host/index.ts'
import type { RunChild } from '#shared/protocol/snapshot.ts'
import { ChildFaces, ChildHood } from './ChildAgents.tsx'
import { childHue, childrenSummary, describeChild, helpersNow, HOBKIN_HUE, satellitesOf } from './child-summary.ts'
import { useMainChildren, useRunChildren } from './children.ts'
import { mapPlaces } from './map-places.ts'
import { SaidLine } from './parts.tsx'
import { confirmExecution, createStopConfirmationAuthority, executionFeedbackRows, executionKey, executionTargets, type ExecutionControl } from './actions.ts'
import { runExecution, runWork, useExecution, useWorkUi } from './store.ts'
import { useChat } from '../chat/chat-store.ts'

/**
 * hobkin delegating to many: hobkin on the left, wired to every agent and routine running now, each a node with
 * its small face, what it is on, and its tier. A wire carries a pulse back to hobkin when its agent reports, a new
 * agent bubbles up into its place, and while work mode is on the room for every agent hobkin may run at once is
 * drawn, free or taken, the free ones until the map has eight places and then one row that counts the rest
 * (`mapPlaces`). A node opens the agent's canvas. A work agent can be stopped from its node, the two ways
 * hobkin's k stops one.
 *
 * The agents an agent spawned through pi-extended-teams sit to its right as small satellites, wired to it the way
 * it is wired to hobkin: their faces only, each with how it stands on hover, as folded as an agent's page has them. A
 * pulse runs back along a child's wire when it reports. They cannot be opened: hobkin has no way to reach them. The
 * helpers hobkin's own chat spawned stand under its name, the same small faces, while any is out.
 *
 * Positions ride transforms on one spring, so the nodes, their wires and hobkin move together and a change
 * mid-flight retargets. Under Still they are placed where they belong and only fade.
 */

const NODE_H = 60
const GAP = 10
/** The map is never shorter than hobkin and its name, and its helpers under it when it has any out. */
const MIN_H = 150
const MIN_H_HELPED = 184

/** How the map sits in the width it has. A narrow canvas brings hobkin and the wires in closer. */
const ROOMY = { left: 136, wire: 118, hob: 92 }
const NARROW = { left: 84, wire: 56, hob: 64 }

/** A node's satellites: rows this tall and apart, and as many as fit beside the node. */
const SATELLITE = { row: 18, gap: 3, room: 3 }
/** A node's satellites are their faces only, folded as an agent's page folds them: its page lists them. */
const FACES = { wire: 14, width: 18 }

/** The nodes' spring: a new one bubbles up and overshoots a little, and a move between places settles the same way. */
const NODE_SPRING = { type: 'spring', duration: 0.62, bounce: 0.32 } as const

/**
 * Wires are drawn in the map's own coordinates and stretched from their start. Motion puts an SVG element's origin
 * at its middle unless told, so the origin is given in Motion's own terms.
 */
const SVG_ORIGIN = { transformBox: 'view-box', originX: 0, originY: 0 } as const

/** Where everything sits for this many places: the top of each place and hobkin's middle. */
function layoutFor(places: number, helped: boolean) {
  const column = places * NODE_H + Math.max(0, places - 1) * GAP
  const height = Math.max(column, helped ? MIN_H_HELPED : MIN_H)
  const top = (height - column) / 2
  return { height, hobkinY: height / 2, placeY: (index: number) => top + index * (NODE_H + GAP) }
}

/**
 * A point on a wire, from 0 at hobkin's pin to 1 at its node's. Every wire is the same smooth curve, level at both
 * ends, one unit wide and one unit tall, stretched to its place, so it moves by transform alone.
 */
const along = (t: number) => ({ x: 1.5 * t * (1 - t) + t ** 3, y: 3 * t ** 2 - 2 * t ** 3 })

function useWidth(element: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const target = element.current
    if (!target) return
    setWidth(target.clientWidth)
    const observer = new ResizeObserver(() => setWidth(target.clientWidth))
    observer.observe(target)
    return () => observer.disconnect()
  }, [element])
  return width
}

type StopRequest = RunningAgent & { source: string; answer: (how: 'for-now' | 'not-approved' | null) => void }

interface MapProps {
  agents: RunningAgent[]
  /** How many agents hobkin may run at once. Their places are drawn while work mode is on, free or taken. */
  capacity: number
  enabled: boolean
  live: boolean
}

export function DelegationMap({ agents, capacity, enabled, live }: MapProps) {
  const still = useStill()
  const box = useRef<HTMLDivElement | null>(null)
  const width = useWidth(box)
  const size = width < 560 ? NARROW : ROOMY
  const source = useHost((state) => JSON.stringify([state.home, state.epoch]))
  const [stopping, setStopping] = useState<StopRequest | null>(null)
  const [lastStop, setLastStop] = useState<string | null>(null)
  const currentAgents = useRef(agents)
  currentAgents.current = agents
  const said = useWorkUi((state) => lastStop ? state.said[`stop:${lastStop}`] : undefined)
  const helpers = helpersNow(useMainChildren())
  // Every running agent, and free workers while the map has fewer than eight places; past that, one row counts the rest.
  const drawn = mapPlaces(enabled ? capacity : 0, agents.length)
  const places = drawn.places
  const { height, hobkinY, placeY } = layoutFor(places, helpers.length > 0)
  const free = Array.from({ length: drawn.free }, (_, index) => agents.length + index)
  const moreAt = agents.length + drawn.free
  const pinX = size.left - 4
  const nodeLeft = size.left + size.wire
  const wire = { from: { x: pinX, y: hobkinY }, width: nodeLeft - pinX, still }

  // An agent that ends while its question is open needs no answer any more.
  useEffect(() => {
    if (stopping && (stopping.source !== source || !agents.some(({ id }) => id === stopping.id))) setStopping(null)
  }, [agents, stopping, source])

  const askToStop = (agent: RunningAgent) => {
    const answer = createStopConfirmationAuthority({ ...agent, source }, () => {
      const current = currentAgents.current.find(({ id }) => id === agent.id)
      const { home, epoch } = hostStore.getState()
      return current ? { ...current, source: JSON.stringify([home, epoch]) } : undefined
    }, (how) => {
      setLastStop(agent.id)
      void runWork({ do: 'stop', run: agent.id, how }, { live, place: `stop:${agent.id}` })
    })
    setStopping({ ...agent, source, answer })
  }

  return (
    <div className="flex flex-col gap-3">
      <div ref={box} className="relative overflow-hidden rounded-3xl bg-background px-4 py-5" style={{ height: height + 40 }}>
        <div className="relative h-full">
          {/* hobkin, in the middle of what it started. Its body's middle is where every wire leaves from. */}
          <motion.div
            className="absolute flex justify-center"
            style={{ left: 0, width: size.left - 16, top: still ? hobkinY - size.hob / 2 : 0 }}
            initial={false}
            animate={still ? {} : { transform: `translateY(${hobkinY - size.hob / 2}px)` }}
            transition={NODE_SPRING}
          >
            <Hob mood={agents.length || helpers.length ? 'working' : enabled ? 'idle' : 'sleepy'} size={size.hob} stage="var(--background)" />
            <span className="absolute top-full mt-1 font-heading text-[13px] font-semibold tracking-[-0.01em]">hobkin</span>
            {helpers.length ? (
              <span data-main-helpers="" className="absolute top-full mt-[27px]">
                <span className="sr-only">{`hobkin's helpers: ${childrenSummary(helpers)}`}</span>
                <ChildFaces spawned={helpers} hue={HOBKIN_HUE} />
              </span>
            ) : null}
          </motion.div>

          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
            <motion.circle
              cx={pinX}
              cy={0}
              r="3.5"
              className="fill-[var(--hb-wire-active)]"
              style={{ ...SVG_ORIGIN, ...(still ? { transform: `translateY(${hobkinY}px)` } : {}) }}
              initial={false}
              animate={still ? {} : { transform: `translateY(${hobkinY}px)` }}
              transition={NODE_SPRING}
            />
            <AnimatePresence initial={false}>
              {agents.map((agent, index) => (
                <Wire key={agent.id} {...wire} toY={placeY(index) + NODE_H / 2} hue={agent.hue} />
              ))}
              {free.map((index) => (
                <Wire key={`free:${index}`} {...wire} toY={placeY(index) + NODE_H / 2} />
              ))}
              {drawn.more ? <Wire key="free:more" {...wire} toY={placeY(moreAt) + NODE_H / 2} /> : null}
            </AnimatePresence>
          </svg>

          {agents.map((agent, index) => (
            <Pulse
              key={agent.id}
              signal={`${agent.doing}|${agent.mood}|${agent.asks ?? ''}`}
              hue={agent.hue}
              quiet={Boolean(agent.asks)}
              {...wire}
              toY={placeY(index) + NODE_H / 2}
              heartbeat={!live}
            />
          ))}

          <AnimatePresence initial={false}>
            {agents.map((agent, index) => (
              <AgentNode key={agent.id} agent={agent} y={placeY(index)} left={nodeLeft} still={still} helpers={FACES} onStop={() => askToStop(agent)} />
            ))}
            {free.map((index) => (
              <Placed key={`free:${index}`} y={placeY(index)} left={nodeLeft} still={still} from={{ lift: 0, scale: 0.96 }}>
                <div className="flex items-center rounded-[14px] border border-dashed border-border px-4 text-[12.5px] text-muted-foreground" style={{ height: NODE_H }}>
                  A free worker
                </div>
              </Placed>
            ))}
            {drawn.more ? (
              <Placed key="free:more" y={placeY(moreAt)} left={nodeLeft} still={still} from={{ lift: 0, scale: 0.96 }}>
                <div className="flex items-center rounded-[14px] border border-dashed border-border px-4 text-[12.5px] text-muted-foreground" style={{ height: NODE_H }}>
                  {drawn.more === 1 ? '1 more free worker' : `${drawn.more} more free workers`}
                </div>
              </Placed>
            ) : null}
          </AnimatePresence>

          {places === 0 ? (
            <p className="absolute right-0 -translate-y-1/2 text-[13.5px] leading-snug text-muted-foreground" style={{ left: nodeLeft, top: hobkinY }}>
              {helpers.length ? "No agents are running. hobkin's own helpers work inside its chat, under it here." : 'Nothing is running. The agents hobkin starts show here, wired to it.'}
            </p>
          ) : null}
        </div>
      </div>

      <OwnedExecutionControls />
      <AnimatePresence>{stopping ? <StopQuestion key={stopping.id} agent={stopping} still={still} onAnswer={(how) => {
        setStopping(null)
        requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(`[data-agent-node="${CSS.escape(stopping.id)}"]`)?.focus())
        stopping.answer(how)
      }} /> : null}</AnimatePresence>
      {said && !stopping ? (
        <SaidLine tone={said.tone} className="px-1">
          {said.text}
        </SaidLine>
      ) : null}
    </div>
  )
}

const sameControls = (left: readonly ExecutionControl[], right: readonly ExecutionControl[]) => sameLists(left, right, sameFields)

/** Authoritative owned rows are separate from the decorative, name-only observations above. */
function OwnedExecutionControls() {
  // The controls alone: the host's other messages do not draw them again.
  const targets = useHostEqual(executionTargets, sameControls)
  const epoch = useHost(state => state.epoch)
  const state = useExecution()
  const rows = executionFeedbackRows(targets, state.results)
  // With nothing to control there is nothing to show: no empty block (the user, 2026-11-24, of "Owned execution controls 0": "i also dont need to see this").
  if (targets.length === 0) return null
  return <details className="group/owned rounded-2xl bg-background text-[13px]">
    <summary className="pressable flex h-10 list-none items-center gap-2 rounded-2xl px-4 font-heading text-[12.5px] font-medium text-muted-foreground outline-offset-[-2px] [&::-webkit-details-marker]:hidden">
      <ChevronRight aria-hidden="true" className="size-3.5 transition-transform duration-[160ms] group-open/owned:rotate-90" />
      Owned execution controls
      <span className="tabular-nums">{targets.length}</span>
    </summary>
    {rows.length ? (
      <ul className="flex flex-col gap-1 px-4 pb-3">
        {rows.map(({ target, active, result }) => (
          <OwnedExecutionRow
            key={executionKey(target)}
            target={target}
            source={epoch}
            active={active}
            result={result}
            pending={state.pending}
          />
        ))}
      </ul>
    ) : null}
  </details>
}
function OwnedExecutionRow({ target, source, active, result, pending }: { target: ExecutionControl; source: number; active: boolean; result?: import('./actions.ts').ExecutionResult; pending: Record<string, true> }) {
  const [question, setQuestion] = useState<{ mode: 'stop' | 'force'; answer: (yes: boolean) => void } | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const first = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { if (question) first.current?.focus() }, [question])
  useEffect(() => { if (!active) setQuestion(null) }, [active])
  const ask = (mode: 'stop' | 'force', button: HTMLButtonElement) => {
    opener.current = button
    const answer = confirmExecution(
      target,
      () => hostStore.getState().epoch === source
        ? executionTargets(hostStore.getState())
        : [],
      () => {
        if (target.kind === 'main') {
          useChat.getState().stop(mode, target)
        } else {
          void runExecution(target, mode).catch(() => {})
        }
      },
    )
    setQuestion({ mode, answer })
  }
  const answer = (yes: boolean) => {
    question?.answer(yes)
    setQuestion(null)
    opener.current?.focus()
  }
  return <li className="flex flex-col gap-1.5 border-t border-border/60 py-2.5 first:border-t-0" aria-label={`${target.label}, ${target.agentId ?? target.runId}, root ${target.rootId}`}>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <p className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
        <span className="font-medium text-foreground">{target.label}</span> · {target.agentId ?? target.runId} · root {target.rootId} · parent {target.parentId ?? 'none'}
      </p>
      {active ? (
        <span className="flex shrink-0 items-center gap-1">
          {(['stop', 'force'] as const).map((mode) => (
            <Button
              key={mode}
              variant={mode === 'force' ? 'ghost' : 'outline'}
              size="sm"
              className={mode === 'force' ? 'text-bad-fg' : undefined}
              disabled={!(mode === 'force' ? target.canForce : target.canStop) || pending[executionKey(target, mode)]}
              onClick={(event) => ask(mode, event.currentTarget)}
            >
              {mode === 'force' ? 'Force Stop' : 'Stop Agent'}
            </Button>
          ))}
        </span>
      ) : null}
    </div>
    {active && question ? (
      <div
        role="group"
        aria-label={`Confirm ${question.mode} ${target.label}`}
        className="flex flex-wrap items-center gap-2 rounded-xl bg-tone-1 px-3 py-2"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            answer(false)
          }
        }}
      >
        <p className="min-w-0 flex-1 text-[12.5px]">{question.mode === 'force' ? 'Force Stop' : 'Stop'} this exact execution? Detached cleanup remains unknown.</p>
        <Button ref={first} variant="ghost" size="sm" onClick={() => answer(false)}>
          Cancel
        </Button>
        <Button variant="destructive" size="sm" onClick={() => answer(true)}>
          Confirm {question.mode}
        </Button>
      </div>
    ) : null}
    {result ? <p role="status" className="text-[12.5px] text-muted-foreground">{result.text}</p> : null}
  </li>
}

/**
 * Something that sits in one of the map's places, and moves to its new place on the nodes' spring. It arrives from
 * a little below and smaller (`from`), and leaves where it was. Under Still it is placed and only fades.
 */
function Placed({ y, left, still, from, children }: { y: number; left: number; still: boolean; from: { lift: number; scale: number }; children: ReactNode }) {
  const at = (lift: number, scale: number) => `translateY(${y + lift}px) scale(${scale})`
  return (
    <motion.div
      className="absolute right-0"
      style={{ left, top: still ? y : 0 }}
      initial={still ? { opacity: 0 } : { opacity: 0, transform: at(from.lift, from.scale) }}
      animate={still ? { opacity: 1 } : { opacity: 1, transform: at(0, 1) }}
      exit={still ? { opacity: 0, transition: { duration: 0.16 } } : { opacity: 0, transform: at(0, 0.9), transition: { duration: 0.2 } }}
      transition={{ transform: NODE_SPRING, opacity: { duration: 0.22 } }}
    >
      {children}
    </motion.div>
  )
}

interface WireProps {
  from: { x: number; y: number }
  toY: number
  width: number
  /** The agent's hue tints its wire. A wire to a free place has none, and is dashed. */
  hue?: number
  still: boolean
}

/** One wire, hobkin's pin to its node's. It grows out from hobkin as its agent arrives, and follows its node when the places change. */
function Wire({ from, toY, width, hue, still }: WireProps) {
  // A wire that runs level would have no height at all. A hair keeps it drawn.
  const rise = Math.abs(toY - from.y) < 0.5 ? 0.5 : toY - from.y
  const placed = `translateX(${from.x}px) translateY(${from.y}px) scaleX(1) scaleY(${rise})`
  const free = hue === undefined
  return (
    <motion.g
      style={{ ...SVG_ORIGIN, ...(still ? { transform: placed } : {}) }}
      initial={still ? { opacity: 0 } : { opacity: 0, transform: `translateX(${from.x}px) translateY(${from.y}px) scaleX(0.6) scaleY(0.02)` }}
      animate={still ? { opacity: 1 } : { opacity: 1, transform: placed }}
      exit={{ opacity: 0, transition: { duration: 0.16 } }}
      transition={{ transform: NODE_SPRING, opacity: { duration: 0.26 } }}
    >
      <path
        d={`M0 0C${width / 2} 0 ${width / 2} 1 ${width} 1`}
        vectorEffect="non-scaling-stroke"
        fill="none"
        strokeLinecap="round"
        strokeWidth={free ? 1.2 : 1.8}
        strokeDasharray={free ? '4 5' : undefined}
        className={free ? 'stroke-border-strong opacity-45' : 'opacity-80'}
        style={free ? undefined : { stroke: `color-mix(in oklab, oklch(0.62 0.11 ${hue}) 60%, var(--hb-wire))` }}
      />
    </motion.g>
  )
}

/** How often a sample agent reports back, give or take, so the map can be seen working with no host. */
const SAMPLE_REPORT_MS = 5600

interface PulseProps extends Omit<WireProps, 'hue'> {
  /** What its agent last reported. A change sends a pulse. */
  signal: string
  hue: number
  /** An agent waiting for the user does not report on its own. */
  quiet?: boolean
  heartbeat: boolean
}

/**
 * The pulse that runs back along a wire when its agent reports: to hobkin when what an agent is doing or its mood
 * changed, to an agent when its child sent its report. With no host the sample agents report now and then on their
 * own. Under Still nothing travels.
 */
function Pulse({ signal, hue, quiet = false, from, toY, width, still, heartbeat }: PulseProps) {
  const [beat, setBeat] = useState(0)
  const reported = useRef(signal)

  useEffect(() => {
    if (signal === reported.current) return
    reported.current = signal
    setBeat((count) => count + 1)
  }, [signal])

  useEffect(() => {
    if (!heartbeat || quiet) return
    // Each agent keeps its own time, so no two report in step.
    const timer = setInterval(() => setBeat((count) => count + 1), SAMPLE_REPORT_MS + (hue % 9) * 470)
    return () => clearInterval(timer)
  }, [heartbeat, quiet, hue])

  if (still || beat === 0) return null
  // From the agent back to hobkin.
  const points = Array.from({ length: 11 }, (_, index) => {
    const { x, y } = along(1 - index / 10)
    return `translateX(${from.x + x * width}px) translateY(${from.y + y * (toY - from.y)}px)`
  })
  return (
    <motion.span
      key={beat}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 -mt-1 -ml-1 size-2 rounded-full bg-[var(--hb-wire-pulse)] shadow-[0_0_0_1.5px_var(--hb-wire-active),0_0_12px_3px_color-mix(in_oklab,var(--hb-accent)_55%,transparent)]"
      initial={{ opacity: 0, transform: points[0] }}
      animate={{ opacity: [0, 1, 1, 0], transform: points }}
      transition={{ duration: 1.15, ease: [0.77, 0, 0.175, 1], opacity: { duration: 1.15, times: [0, 0.12, 0.82, 1] } }}
    />
  )
}

type Helpers = typeof FACES

/** One agent's node, with its children beside it. It opens the agent's canvas, and Right reaches Stop on a work agent. */
function AgentNode({ agent, y, left, still, helpers, onStop }: { agent: RunningAgent; y: number; left: number; still: boolean; helpers: Helpers; onStop: () => void }) {
  const spawned = useRunChildren(agent.id)
  const summary = childrenSummary(spawned)
  const said = agent.asks ? `${agent.title}, waiting for you: ${agent.asks}.` : `${agent.title}, ${agent.project}, ${agent.doing}.`
  const open = () => {
    useView.getState().openAgentCanvas(agent.id)
    // The keyboard goes along to the agent's canvas.
    requestCanvasFocus()
  }

  return (
    <Placed y={y} left={left} still={still} from={{ lift: 34, scale: 0.6 }}>
      <div className="flex">
        <div data-work-item="" className="group relative flex min-w-0 flex-1 items-center gap-1 rounded-[14px] bg-surface pr-2 shadow-panel" style={{ height: NODE_H }}>
          <span aria-hidden="true" className="absolute top-1/2 -left-1 size-2 -translate-y-1/2 rounded-full" style={{ background: `oklch(0.62 0.11 ${agent.hue})` }} />
          <button
            type="button"
            data-stop=""
            data-work-main=""
            data-agent-node={agent.id}
            onClick={open}
            aria-label={`${said}${summary ? ` ${summary}.` : ''} Opens its canvas.`}
            className="pressable flex h-full min-w-0 flex-1 scroll-mt-[124px] scroll-mb-6 items-center gap-3 rounded-[14px] pr-2 pl-3 text-left outline-offset-[-2px]"
          >
            <span className="grid w-8 shrink-0 place-items-center">
              <AgentHood hue={agent.hue} size={26} mood={agent.mood} asking={Boolean(agent.asks)} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] leading-tight font-medium">{agent.title}</span>
              <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{agent.asks ?? `${agent.project} · ${agent.doing}`}</span>
            </span>
            <span className="shrink-0 rounded-full border border-border px-1.5 text-[10.5px] leading-4 font-medium text-muted-foreground">{agent.tier}</span>
            <OpenArrow className="size-3.5" />
          </button>
          <Button
            variant="ghost"
            size="sm"
            tabIndex={-1}
            data-row-control=""
            onClick={onStop}
            // Always there, so the pointer finds it where the keyboard does, and nothing shows only under the pointer (053).
            className="shrink-0 text-muted-foreground"
          >
            Stop
          </Button>
        </div>
        {spawned.length ? <Satellites spawned={spawned} hue={agent.hue} still={still} {...helpers} /> : null}
      </div>
    </Placed>
  )
}

/**
 * An agent's children, to the right of its node and wired to its pin. Each sits in its place on the nodes' spring
 * and moves with its node. A queued child's wire is dashed like a free place's, since it has not started.
 */
function Satellites({ spawned, hue, still, wire, width }: { spawned: readonly RunChild[]; hue: number; still: boolean } & Helpers) {
  const { shown, more } = satellitesOf(spawned, SATELLITE.room)
  const rows = shown.length + (more ? 1 : 0)
  const top = (NODE_H - rows * SATELLITE.row - (rows - 1) * SATELLITE.gap) / 2
  const middleOf = (index: number) => top + index * (SATELLITE.row + SATELLITE.gap) + SATELLITE.row / 2
  const pin = { from: { x: 0, y: NODE_H / 2 }, width: wire, still }
  const hueOf = (child: RunChild) => childHue(hue, spawned.indexOf(child))
  const pill = 'flex w-fit max-w-full items-center gap-1.5 rounded-full px-[3px]'

  return (
    <div aria-hidden="true" className="relative shrink-0" style={{ width: wire + width, height: NODE_H }}>
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <circle cx={0} cy={NODE_H / 2} r="2.5" style={{ fill: `oklch(0.62 0.11 ${hue})` }} />
        <AnimatePresence initial={false}>
          {shown.map((child, index) => (
            <Wire key={child.name} {...pin} toY={middleOf(index)} hue={child.state === 'queued' ? undefined : hueOf(child)} />
          ))}
          {more ? <Wire key="more" {...pin} toY={middleOf(shown.length)} /> : null}
        </AnimatePresence>
      </svg>
      {shown.map((child, index) => (
        <Pulse key={child.name} signal={child.state === 'reported' || child.state === 'failed' ? child.state : 'out'} hue={hueOf(child)} {...pin} toY={middleOf(index)} heartbeat={false} />
      ))}
      <AnimatePresence initial={false}>
        {shown.map((child, index) => (
          <Placed key={child.name} y={middleOf(index) - SATELLITE.row / 2} left={wire} still={still} from={{ lift: 8, scale: 0.6 }}>
            <div title={describeChild(child)} className={cn(pill, 'bg-surface shadow-panel')} style={{ height: SATELLITE.row }}>
              <ChildHood child={child} hue={hueOf(child)} />
            </div>
          </Placed>
        ))}
        {more ? (
          <Placed key="more" y={middleOf(shown.length) - SATELLITE.row / 2} left={wire} still={still} from={{ lift: 8, scale: 0.6 }}>
            <div title={childrenSummary(spawned)} className={cn(pill, 'border border-dashed border-border text-[10.5px] text-muted-foreground tabular-nums')} style={{ height: SATELLITE.row }}>
              +{more}
            </div>
          </Placed>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

/** hobkin's own question when k is pressed on a running agent: how it stops, or that it keeps running. */
function StopQuestion({ agent, still, onAnswer }: { agent: RunningAgent; still: boolean; onAnswer: (how: 'for-now' | 'not-approved' | null) => void }) {
  const first = useRef<HTMLButtonElement | null>(null)
  useEffect(() => first.current?.focus({ preventScroll: true }), [])
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // From one of its other choices Escape first steps back to this one. From here it keeps the agent running,
    // and the frame leaves the key alone.
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    onAnswer(null)
  }
  return (
    <motion.div
      data-work-item=""
      role="group"
      aria-label={`Stop ${agent.title}`}
      onKeyDown={onKeyDown}
      className="flex flex-wrap items-center gap-x-2 gap-y-3 rounded-3xl bg-background px-5 py-4"
      initial={still ? { opacity: 0 } : { opacity: 0, transform: 'translateY(-10px) scale(0.98)' }}
      animate={still ? { opacity: 1 } : { opacity: 1, transform: 'translateY(0px) scale(1)' }}
      exit={still ? { opacity: 0, transition: { duration: 0.14 } } : { opacity: 0, transform: 'translateY(-6px) scale(0.98)', transition: { duration: 0.14 } }}
      transition={{ type: 'spring', duration: 0.42, bounce: 0.12 }}
    >
      <p className="min-w-0 basis-full text-[14px] leading-snug">
        <span className="font-medium">{agent.title}</span> is running. What do you want to do?
      </p>
      {agent.kind === 'work' ? (
        <>
          <Button ref={first} variant="destructive" size="sm" data-stop="" data-work-main="" onClick={() => onAnswer('not-approved')}>
            Stop it: not approved
          </Button>
          <Button variant="outline" size="sm" tabIndex={-1} data-row-control="" onClick={() => onAnswer('for-now')}>
            Stop it for now
          </Button>
        </>
      ) : (
        // A routine has no item to say no to. It is cancelled, as k does on a job.
        <Button ref={first} variant="destructive" size="sm" data-stop="" data-work-main="" onClick={() => onAnswer('for-now')}>
          Stop it
        </Button>
      )}
      <Button variant="ghost" size="sm" tabIndex={-1} data-row-control="" onClick={() => onAnswer(null)}>
        Keep it running
      </Button>
    </motion.div>
  )
}
