import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { requestCanvasFocus } from '@/app/focus.ts'
import type { RunningAgent } from '@/app/running-agents.ts'
import { useStill } from '@/app/still.ts'
import { useView } from '@/app/view-store.ts'
import { Hob } from '@/avatar/Hob.tsx'
import { AgentHood } from '@/components/Mark.tsx'
import { Button } from '@/components/ui/button.tsx'
import { SaidLine } from './parts.tsx'
import { runWork, useWorkUi } from './store.ts'

/**
 * hobkin delegating to many: hobkin on the left, wired to every agent and routine running now, each a node with
 * its small face, what it is on, and its tier. A wire carries a pulse back to hobkin when its agent reports, a new
 * agent bubbles up into its place, and while work mode is on the room for every agent hobkin may run at once is
 * drawn, free or taken. A node opens the agent's canvas. A work agent can be stopped from its node, the two ways
 * hobkin's k stops one.
 *
 * Positions ride transforms on one spring, so the nodes, their wires and hobkin move together and a change
 * mid-flight retargets. Under Still they are placed where they belong and only fade.
 */

const NODE_H = 60
const GAP = 10
/** The map is never shorter than hobkin and its name. */
const MIN_H = 150

/** How the map sits in the width it has. A narrow canvas brings hobkin and the wires in closer. */
const ROOMY = { left: 136, wire: 118, hob: 92 }
const NARROW = { left: 84, wire: 56, hob: 64 }

/** The nodes' spring: a new one bubbles up and overshoots a little, and a move between places settles the same way. */
const NODE_SPRING = { type: 'spring', duration: 0.62, bounce: 0.32 } as const

/**
 * Wires are drawn in the map's own coordinates and stretched from their start. Motion puts an SVG element's origin
 * at its middle unless told, so the origin is given in Motion's own terms.
 */
const SVG_ORIGIN = { transformBox: 'view-box', originX: 0, originY: 0 } as const

/** Where everything sits for this many places: the top of each place and hobkin's middle. */
function layoutFor(places: number) {
  const column = places * NODE_H + Math.max(0, places - 1) * GAP
  const height = Math.max(column, MIN_H)
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
  const size = useWidth(box) < 560 ? NARROW : ROOMY
  const [stopping, setStopping] = useState<RunningAgent | null>(null)
  const said = useWorkUi((state) => state.said['map'])
  const places = Math.max(agents.length, enabled ? capacity : 0)
  const { height, hobkinY, placeY } = layoutFor(places)
  const free = Array.from({ length: places - agents.length }, (_, index) => agents.length + index)
  const pinX = size.left - 4
  const nodeLeft = size.left + size.wire
  const wire = { from: { x: pinX, y: hobkinY }, width: nodeLeft - pinX, still }

  // An agent that ends while its question is open needs no answer any more.
  useEffect(() => {
    if (stopping && !agents.some(({ id }) => id === stopping.id)) setStopping(null)
  }, [agents, stopping])

  const stop = async (agent: RunningAgent, how: 'for-now' | 'not-approved' | null) => {
    setStopping(null)
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(`[data-agent-node="${CSS.escape(agent.id)}"]`)?.focus())
    if (how) await runWork({ do: 'stop', run: agent.id, how }, { live, place: 'map' })
  }

  return (
    <div className="flex flex-col gap-3">
      <div ref={box} className="relative overflow-hidden rounded-3xl bg-background px-4 py-5" style={{ height: height + 40 }}>
        <div className="relative h-full">
          {/* hobkin, in the middle of what it started. Its hood's middle is where every wire leaves from. */}
          <motion.div
            className="absolute flex justify-center"
            style={{ left: 0, width: size.left - 16, top: still ? hobkinY - size.hob / 2 : 0 }}
            initial={false}
            animate={still ? {} : { transform: `translateY(${hobkinY - size.hob / 2}px)` }}
            transition={NODE_SPRING}
          >
            <Hob mood={agents.length ? 'working' : enabled ? 'idle' : 'sleepy'} size={size.hob} stage="var(--background)" />
            <span className="absolute top-full mt-1 font-heading text-[13px] font-semibold tracking-[-0.01em]">hobkin</span>
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
            </AnimatePresence>
          </svg>

          {agents.map((agent, index) => (
            <Pulse key={agent.id} agent={agent} {...wire} toY={placeY(index) + NODE_H / 2} heartbeat={!live} />
          ))}

          <AnimatePresence initial={false}>
            {agents.map((agent, index) => (
              <AgentNode key={agent.id} agent={agent} y={placeY(index)} left={nodeLeft} still={still} onStop={() => setStopping(agent)} />
            ))}
            {free.map((index) => (
              <Placed key={`free:${index}`} y={placeY(index)} left={nodeLeft} still={still} from={{ lift: 0, scale: 0.96 }}>
                <div className="flex items-center rounded-[14px] border border-dashed border-border px-4 text-[12.5px] text-muted-foreground" style={{ height: NODE_H }}>
                  A free worker
                </div>
              </Placed>
            ))}
          </AnimatePresence>

          {places === 0 ? (
            <p className="absolute right-0 -translate-y-1/2 text-[13.5px] leading-snug text-muted-foreground" style={{ left: nodeLeft, top: hobkinY }}>
              Nothing is running. The agents hobkin starts show here, wired to it.
            </p>
          ) : null}
        </div>
      </div>

      <AnimatePresence>{stopping ? <StopQuestion key={stopping.id} agent={stopping} still={still} onAnswer={(how) => void stop(stopping, how)} /> : null}</AnimatePresence>
      {said && !stopping ? (
        <SaidLine tone={said.tone} className="px-1">
          {said.text}
        </SaidLine>
      ) : null}
    </div>
  )
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

/**
 * The pulse that runs back along a wire to hobkin when its agent reports: what it is doing or its mood changed.
 * With no host the sample agents report now and then on their own. Under Still nothing travels.
 */
function Pulse({ agent, from, toY, width, still, heartbeat }: Omit<WireProps, 'hue'> & { agent: RunningAgent; heartbeat: boolean }) {
  const [beat, setBeat] = useState(0)
  const reported = useRef(`${agent.doing}|${agent.mood}|${agent.asks ?? ''}`)

  useEffect(() => {
    const now = `${agent.doing}|${agent.mood}|${agent.asks ?? ''}`
    if (now === reported.current) return
    reported.current = now
    setBeat((count) => count + 1)
  }, [agent.doing, agent.mood, agent.asks])

  useEffect(() => {
    if (!heartbeat || agent.asks) return
    // Each agent keeps its own time, so no two report in step.
    const timer = setInterval(() => setBeat((count) => count + 1), SAMPLE_REPORT_MS + (agent.hue % 9) * 470)
    return () => clearInterval(timer)
  }, [heartbeat, agent.asks, agent.hue])

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

/** One agent's node. It opens the agent's canvas, and Right reaches Stop on a work agent. */
function AgentNode({ agent, y, left, still, onStop }: { agent: RunningAgent; y: number; left: number; still: boolean; onStop: () => void }) {
  const open = () => {
    useView.getState().openAgentCanvas(agent.id)
    // The keyboard goes along to the agent's canvas.
    requestCanvasFocus()
  }

  return (
    <Placed y={y} left={left} still={still} from={{ lift: 34, scale: 0.6 }}>
      <div data-work-item="" className="group relative flex items-center gap-1 rounded-[14px] bg-surface pr-2 shadow-panel" style={{ height: NODE_H }}>
        <span aria-hidden="true" className="absolute top-1/2 -left-1 size-2 -translate-y-1/2 rounded-full" style={{ background: `oklch(0.62 0.11 ${agent.hue})` }} />
        <button
          type="button"
          data-stop=""
          data-work-main=""
          data-agent-node={agent.id}
          onClick={open}
          aria-label={agent.asks ? `${agent.title}, waiting for you: ${agent.asks}. Opens its canvas.` : `${agent.title}, ${agent.project}, ${agent.doing}. Opens its canvas.`}
          className="flex h-full min-w-0 flex-1 scroll-mt-[124px] scroll-mb-6 items-center gap-3 rounded-[14px] pl-3 text-left outline-offset-[-2px]"
        >
          <span className="grid w-8 shrink-0 place-items-center">
            <AgentHood hue={agent.hue} size={26} mood={agent.mood} asking={Boolean(agent.asks)} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] leading-tight font-medium">{agent.title}</span>
            <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{agent.asks ?? `${agent.project} · ${agent.doing}`}</span>
          </span>
          <span className="shrink-0 rounded-full border border-border px-1.5 text-[10.5px] leading-4 font-medium text-muted-foreground">{agent.tier}</span>
        </button>
        {agent.kind === 'work' || agent.kind === 'routine' ? (
          <Button
            variant="ghost"
            size="sm"
            tabIndex={-1}
            data-row-control=""
            onClick={onStop}
            className="shrink-0 text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
          >
            Stop
          </Button>
        ) : null}
      </div>
    </Placed>
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
