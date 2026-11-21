import { EdgeLabelRenderer, useStore, type EdgeProps } from '@xyflow/react'
import { AnimatePresence, motion } from 'motion/react'
import { memo, useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { NODE_SIZE } from '#shared/review/layout.ts'
import { WIRE_PHRASE } from '#shared/review/types.ts'
import { ease, tween } from '@/lib/motion.ts'
import { useReduced, useSession, useSessionStore } from '../state/context.tsx'
import { ENTRANCE } from './entrance-plan.ts'
import { useWireEntrance } from './entrance.tsx'
import { hoverShown, isUnchanged } from './levels.ts'
import { pulseLap, runLap } from './pulse-lap.ts'
import { wireCurve, type WireCurve } from './wire-path.ts'

/** How long a wire takes to draw in when the story reaches it. */
const DRAW = { duration: 0.42, ease: ease.out } as const

/**
 * One wire. It leaves the right pin of its source and arrives at the left pin of its target.
 * At rest it is thin and tinted by its kind. On the step's path it is drawn over in the active color, carries a pulse
 * from source to target and says what it is. A wire the model proposed stays dashed until the reviewer confirms it.
 * A wire to code the change did not touch is quieter, and one the focus folded away is not drawn: its node counts it.
 */
function WireComponent({ id, source, target }: EdgeProps) {
  const store = useSessionStore()
  const edge = useSession((session) => session.edgeOf.get(id))
  const fromKind = useSession((session) => session.nodeOf.get(source)?.kind)
  const toKind = useSession((session) => session.nodeOf.get(target)?.kind)
  const unchanged = useSession((session) => isUnchanged(session.nodeOf.get(source)) || isUnchanged(session.nodeOf.get(target)))
  const level = useSession((session) => session.levels.wires[id] ?? 'rest')
  const hover = useSession((session) => hoverShown(session.hover.wires[id] ?? 'none', session.hovered, session.focus))
  const seen = useSession((session) => session.revealed.has(id))
  const open = useSession((session) => session.wire === id)
  const notes = useSession((session) => session.counts.wires[id] ?? 0)
  const sourceFocused = useSession((session) => session.focus.includes(source))
  const targetFocused = useSession((session) => session.focus.includes(target))
  // The end this wire grows from when the story reaches it for the first time, and the move that reached it.
  const grows = useSession((session) => {
    const fresh = session.move.fresh.wires.find((wire) => wire.id === id)
    return fresh ? `${session.move.key}:${fresh.from}` : ''
  })
  const entrance = useWireEntrance(id)
  const reduced = useReduced()

  // The pins are worked out from where the nodes are, not from measured handles: the screen arrives scaled,
  // and a handle measured mid-flight would stay a few pixels off for good.
  const ends = useStore(
    useCallback(
      (flow) => {
        const from = flow.nodeLookup.get(source)?.internals.positionAbsolute
        const to = flow.nodeLookup.get(target)?.internals.positionAbsolute
        return from && to ? `${from.x} ${from.y} ${to.x} ${to.y}` : ''
      },
      [source, target],
    ),
  )
  const curve = useMemo(() => {
    if (!ends || !fromKind || !toKind) return null
    const [fromX = 0, fromY = 0, toX = 0, toY = 0] = ends.split(' ').map(Number)
    return wireCurve({ x: fromX + NODE_SIZE[fromKind].width, y: fromY + NODE_SIZE[fromKind].height / 2 }, { x: toX, y: toY + NODE_SIZE[toKind].height / 2 })
  }, [ends, fromKind, toKind])

  if (!edge || !curve) return null
  // The pointer lights a node's own wires, never the ones its focus folded away: looking never unfolds the life cycle.
  const active = level === 'bright' || open || (hover === 'lit' && level !== 'folded')
  // The words sit near the far end of the wire, beside the neighbor they are about, in the gap between two
  // columns. At the middle they would often land on top of a node the wire passes behind.
  const chipAt = curve.pointAt(sourceFocused === targetFocused ? 0.5 : sourceFocused ? 0.8 : 0.2)
  const fromTarget = grows.endsWith(':target')
  // A dashed wire cannot be drawn by its dash offset, so a proposed wire lights up in place instead.
  const drawsIn = grows !== '' && !edge.proposed && !reduced
  const pulses = active && !reduced
  const chip = level === 'bright' || open || (notes > 0 && level !== 'folded')

  return (
    <>
      <g className="rv-wire" data-wire={edge.kind} data-proposed={edge.proposed} data-unchanged={unchanged} data-level={level} data-hover={hover} data-seen={seen} data-active={active}>
        <path className="rv-wire-hit" d={curve.d} />
        {/* The entrance: the wire inks in after the nodes it joins, then settles into its resting line. */}
        <motion.g initial={entrance ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={entrance ? { ...tween.fade, delay: entrance.delay + ENTRANCE.draw * 0.7 } : { duration: 0 }}>
          <path className="rv-wire-base" d={curve.d} />
        </motion.g>
        {entrance ? (
          <motion.path
            className="rv-wire-draw"
            d={curve.d}
            initial={{ pathLength: 0, opacity: 1 }}
            animate={{ pathLength: 1, opacity: 0 }}
            transition={{ pathLength: { delay: entrance.delay, duration: ENTRANCE.draw, ease: ease.out }, opacity: { delay: entrance.delay + ENTRANCE.draw, duration: 0.2, ease: 'linear' } }}
          />
        ) : null}
        <AnimatePresence initial={false}>
          {active && !edge.proposed ? (
            <motion.path
              key={drawsIn ? grows : 'lit'}
              className="rv-wire-live"
              d={curve.d}
              // Seen for the first time, it draws from the end that was already on screen. After that it is simply there.
              initial={drawsIn ? { pathLength: 0, pathOffset: fromTarget ? 1 : 0, opacity: 1 } : { pathLength: 1, pathOffset: 0, opacity: 0 }}
              animate={{ pathLength: 1, pathOffset: 0, opacity: 1 }}
              exit={{ opacity: 0, transition: tween.exit }}
              transition={reduced ? { duration: 0 } : drawsIn ? DRAW : tween.fade}
            />
          ) : null}
        </AnimatePresence>
      </g>
      {pulses || chip ? (
        <EdgeLabelRenderer>
          {/* Before the chip, so the pulse passes under its own wire's words, as it did in the SVG. */}
          {pulses ? <Pulse curve={curve} /> : null}
          {chip ? (
            <button
              type="button"
              className="rv-chip nodrag nopan"
              data-proposed={edge.proposed}
              data-wire-chip={id}
              style={{ left: chipAt.x, top: chipAt.y }}
              aria-label={`${WIRE_PHRASE[edge.kind]}${edge.label ? `: ${edge.label}` : ''}${edge.proposed ? '. Proposed.' : ''}`}
              onClick={(event) => {
                event.stopPropagation()
                store.getState().openWire(open ? null : id)
              }}
            >
              <span>{WIRE_PHRASE[edge.kind]}</span>
              {edge.label ? <em>{edge.label}</em> : null}
              {notes > 0 ? (
                <b className="rv-chip-notes" aria-label={`${notes} ${notes === 1 ? 'note' : 'notes'}`}>
                  {notes}
                </b>
              ) : null}
            </button>
          ) : null}
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}

/**
 * The pulse on an active wire, from its source to its target and round again at one speed. It is an HTML dot in the
 * layer of the wires' words, moved by its transform through the Web Animations API, so the compositor runs the loop.
 * It keeps one animation while it shows: a wire that moves only changes its keyframes (`runLap`). Its size and colors
 * are the SVG dot's: a 2.9 px fill inside a 1 px ring of the active wire's color.
 */
function Pulse({ curve }: { curve: WireCurve }) {
  const dot = useRef<HTMLSpanElement>(null)
  const running = useRef<ReturnType<typeof runLap> | null>(null)
  const lap = useMemo(() => pulseLap(curve.pointAt), [curve])

  // Before the first paint, so the dot is never seen off its wire.
  useLayoutEffect(() => {
    const element = dot.current
    if (!element) return
    if (running.current) running.current.follow(lap)
    else running.current = runLap(element, lap)
  }, [lap])
  useLayoutEffect(
    () => () => {
      running.current?.stop()
      running.current = null
    },
    [],
  )

  return (
    <span
      ref={dot}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 -mt-[3.9px] -ml-[3.9px] size-[7.8px] rounded-full border border-[color:var(--hb-wire-active)] bg-[var(--hb-wire-pulse)]"
    />
  )
}

export const Wire = memo(WireComponent)
