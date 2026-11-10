import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AgentHood } from '@/components/Mark.tsx'
import { dur, spring, staggerDelay, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { useWidth } from './hooks.ts'
import { hueOf, toneFill } from './look.ts'
import { fractionAt, skyMarks, sunHeight, type SkyMark, type Span } from './sky-math.ts'
import { GROUND, heightAt, HORIZON, RIDGES, sceneOf, SKY_HEIGHT, STARS, type PlacedBand, type PlacedMark, type Scene, type TimeLabel } from './sky-scene.ts'
import type { Hold, Routine, RoutinesData } from './types.ts'
import { clockText, outcomeOf, ownTime, type Tone } from './words.ts'

/**
 * Time as a landscape. The sun crosses the sky over the hills by day and the moon by night, and the routines
 * sit on its path at the times they run: rings for what is still to come, the next one in yellow, filled
 * dots for what already ran, coloured by how it went, and a band for a window. The dashed line is now.
 *
 * Close up the sky shows a day that rolls with the clock: the last eight hours and the next sixteen, so what
 * just ran and what runs next are both always in view. Further out it shows the next seven days.
 */

export interface SkyProps {
  span: Span
  /** Close up: what already ran, and each check of a window. */
  detail: boolean
  labels: 'hours' | 'days'
  now: number
  zone: string
  data: RoutinesData
  holds: Record<string, Hold | null>
  /** The routine whose times are lit. The others step back. */
  lit: string | null
  /** The marks and the scene, worked out ahead by the store. Without them the sky works them out as it draws. */
  marks?: SkyMark[]
  scene?: Scene | null
  /** Told the sky's width whenever it is measured, so the next scene is drawn ahead for it. */
  onWidth?: (width: number) => void
  onLight?: (id: string | null) => void
  onPick?: (id: string, key: string) => void
}

/** How a mark talks about its routine: its name, and a time as the routine has it. */
interface Naming {
  titleOf: (id: string) => string
  timeOf: (id: string, instant: number) => string
}

/** Day turning to night, at the speed of a change of theme. */
const fade = { duration: dur.color, ease: 'linear' } as const
const crossfade = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: tween.enter },
  exit: { opacity: 0, transition: tween.exit },
} as const

/** How long the marks take to land, one after another across the sky, when the sky first draws. */
const LANDING = staggerDelay + dur.travel

export function Sky({ span, detail, labels, now, zone, data, holds, lit, marks: preparedMarks, scene: preparedScene, onWidth, onLight, onPick }: SkyProps) {
  const box = useRef<HTMLDivElement | null>(null)
  const measured = useWidth(box)
  const arriving = useArriving()
  useEffect(() => {
    if (measured > 0) onWidth?.(measured)
  }, [measured, onWidth])

  const ownMarks = useMemo(
    () => (preparedMarks ? null : skyMarks({ span, now, routines: data.routines, logs: data.logs, holds, detail })),
    [preparedMarks, span, now, data.routines, data.logs, holds, detail],
  )
  const marks = preparedMarks ?? ownMarks ?? []
  const ownScene = useMemo(
    () => (preparedScene !== undefined || measured === 0 ? null : sceneOf({ span, width: measured, zone, labels, now, marks })),
    [preparedScene, span, measured, zone, labels, now, marks],
  )
  const scene = preparedScene ?? ownScene
  // A scene drawn ahead is drawn for its own width, so nothing moves while the sky is measured again.
  const width = scene?.width ?? measured
  const naming = useNaming(data.routines, zone)

  const sun = sunHeight(span, now)
  const night = Math.min(1, Math.max(0, -sun * 1.8))
  const nowX = fractionAt(span, now) * width
  const nowY = heightAt(span, now)
  const running = Object.keys(data.running).filter((id) => data.routines.some((routine) => routine.id === id))

  return (
    <div ref={box} role="group" aria-label="When routines run, in the sky" className="relative w-full overflow-hidden" style={{ height: SKY_HEIGHT }}>
      {/* Dusk settles over the sky after dark. */}
      <motion.div className="pointer-events-none absolute inset-0 bg-tone-3" initial={false} animate={{ opacity: night * 0.85 }} transition={fade} />
      {scene ? (
        <>
          <Heavens scene={scene} width={width} night={night} lit={lit} labels={labels} />
          <SunAndMoon x={nowX} y={nowY} sunUp={sun >= 0} arriving={arriving} />
          <Hills ridges={scene.ridges} width={width} pulledBack={labels === 'days'} />
          <NowLine x={nowX} y={nowY} />
          <RunningHoods ids={running} x={nowX} naming={naming} />
          <BandTargets bands={scene.bands} width={width} naming={naming} onLight={onLight} onPick={onPick} />
          <Marks points={scene.points} now={now} lit={lit} arriving={arriving} width={width} naming={naming} onLight={onLight} onPick={onPick} />
          <TimeLabels labels={scene.labels} kind={labels} />
          <NowClock x={nowX} text={clockText(now, zone)} />
        </>
      ) : null}
    </div>
  )
}

/** True for a moment after the sky first draws: marks land one after another then, and move together after. */
function useArriving(): boolean {
  const [arriving, setArriving] = useState(true)
  useEffect(() => {
    // Long enough for the last mark to land and settle on its spring.
    const timer = setTimeout(() => setArriving(false), (LANDING + dur.travel) * 1000)
    return () => clearTimeout(timer)
  }, [])
  return arriving
}

function useNaming(routines: readonly Routine[], zone: string): Naming {
  return useMemo(() => {
    const byId = new Map(routines.map((routine) => [routine.id, routine]))
    return {
      titleOf: (id) => byId.get(id)?.title ?? id,
      // A time as the routine itself has it: in its own timezone, with the time here when that differs.
      timeOf: (id, instant) => ownTime(instant, byId.get(id)?.timezone ?? zone, zone),
    }
  }, [routines, zone])
}

/** Behind everything: the stars, the days, the path of the sun and the moon, and each window along it. */
function Heavens({ scene, width, night, lit, labels }: { scene: Scene; width: number; night: number; lit: string | null; labels: 'hours' | 'days' }) {
  const bandOpacity = (routineId: string) => (lit === null ? 0.1 : lit === routineId ? 0.26 : 0.05)

  return (
    <svg className="pointer-events-none absolute inset-0" width={width} height={SKY_HEIGHT} aria-hidden="true">
      <motion.g initial={false} animate={{ opacity: night }} transition={fade}>
        {STARS.map(([x, y, r]) => (
          <circle key={`${x}-${y}`} cx={x * width} cy={14 + y * (HORIZON - 40)} r={r} fill="var(--hb-text)" opacity="0.55" />
        ))}
      </motion.g>
      {/* The track changes shape between the day and the week, so it crossfades. */}
      <AnimatePresence initial={false}>
        <motion.g key={labels} {...crossfade}>
          {scene.midnights.map((x) => (
            <line key={x} x1={x} x2={x} y1={10} y2={SKY_HEIGHT} stroke="var(--hb-text)" strokeOpacity="0.09" strokeDasharray="1 5" strokeLinecap="round" />
          ))}
          <path d={scene.track.all} fill="none" stroke="var(--hb-text)" strokeOpacity="0.22" strokeWidth="1.5" strokeDasharray="1.5 6" strokeLinecap="round" />
          <path d={scene.track.day} fill="none" stroke="var(--hb-sun)" strokeOpacity="0.8" strokeWidth="2" strokeDasharray="1.5 6" strokeLinecap="round" />
          {scene.bands.map(({ mark, d }) => (
            <path
              key={mark.key}
              d={d}
              fill="none"
              stroke="var(--hb-text)"
              strokeOpacity={bandOpacity(mark.routineId)}
              strokeWidth="7"
              strokeLinecap="round"
              className="transition-[stroke-opacity] duration-[220ms] ease-[ease]"
            />
          ))}
        </motion.g>
      </AnimatePresence>
    </svg>
  )
}

/** The sun by day and the moon by night, at now on their path. It rises from behind the hills as the sky arrives. */
function SunAndMoon({ x, y, sunUp, arriving }: { x: number; y: number; sunUp: boolean; arriving: boolean }) {
  return (
    <motion.div
      className="pointer-events-none absolute top-0 left-0 size-10"
      initial={{ transform: `translateX(${x - 20}px) translateY(${HORIZON + 36}px)` }}
      animate={{ transform: `translateX(${x - 20}px) translateY(${y - 20}px)` }}
      transition={arriving ? { ...spring.screen, delay: staggerDelay } : spring.screen}
    >
      <motion.svg viewBox="-20 -20 40 40" className="absolute inset-0" initial={false} animate={{ opacity: sunUp ? 1 : 0 }} transition={fade} aria-hidden="true">
        <circle r="19" fill="var(--hb-sun)" opacity="0.2" />
        <circle r="13" fill="var(--hb-sun)" />
      </motion.svg>
      <motion.svg viewBox="146 36 64 64" className="absolute inset-[5px]" initial={false} animate={{ opacity: sunUp ? 0 : 1 }} transition={fade} aria-hidden="true">
        <path d="M178 40 a30 30 0 1 0 26 44 a24 24 0 0 1 -26 -44 Z" fill="var(--hb-text)" />
      </motion.svg>
    </motion.div>
  )
}

/** The hills. When the sky pulls back to the week, the nearer ones drift further, as a camera would see them. */
function Hills({ ridges, width, pulledBack }: { ridges: string[]; width: number; pulledBack: boolean }) {
  return (
    <svg className="pointer-events-none absolute inset-0" width={width} height={SKY_HEIGHT} aria-hidden="true">
      {RIDGES.map((ridge, index) => (
        <motion.path
          key={ridge.fill}
          d={ridges[index]}
          fill={ridge.fill}
          initial={false}
          animate={{ transform: `translateX(${pulledBack ? ridge.drift : 0}px)` }}
          transition={spring.screen}
        />
      ))}
    </svg>
  )
}

/** Now: a line from the sun or the moon down to the ground. */
function NowLine({ x, y }: { x: number; y: number }) {
  return (
    <motion.div
      className="pointer-events-none absolute top-0 left-0 w-0 border-l border-dashed border-foreground/35"
      style={{ height: SKY_HEIGHT }}
      initial={false}
      animate={{ transform: `translateX(${x}px) translateY(${y + 15}px)` }}
      transition={spring.screen}
    />
  )
}

/** The time now, under the line. */
function NowClock({ x, text }: { x: number; text: string }) {
  return (
    <motion.div className="pointer-events-none absolute top-0 left-0" initial={false} animate={{ transform: `translateX(${x}px) translateY(${GROUND - 9}px)` }} transition={spring.screen} aria-hidden="true">
      <span className="block -translate-x-1/2 rounded-full bg-foreground px-1.5 font-heading text-[10.5px] leading-[18px] font-semibold whitespace-nowrap text-background tabular-nums">{text}</span>
    </motion.div>
  )
}

/** Routines running right now: their small hobkins are out at work, standing at now. A new one pops up like a bubble. */
function RunningHoods({ ids, x, naming }: { ids: string[]; x: number; naming: Naming }) {
  const at = (index: number, lift: number, scale: number) => `translateX(${x + 8 + index * 22}px) translateY(${GROUND - lift}px) scale(${scale})`

  return (
    <AnimatePresence>
      {ids.map((id, index) => (
        <motion.div
          key={id}
          className="absolute top-0 left-0"
          title={`${naming.titleOf(id)} is running`}
          initial={{ opacity: 0, transform: at(index, 20, 0.5) }}
          animate={{ opacity: 1, transform: at(index, 40, 1) }}
          exit={{ opacity: 0, transform: at(index, 30, 0.6), transition: tween.exit }}
          transition={{ transform: spring.alive, opacity: tween.enter }}
        >
          <AgentHood hue={hueOf(id)} size={20} mood="working" />
        </motion.div>
      ))}
    </AnimatePresence>
  )
}

interface PickProps {
  naming: Naming
  onLight?: (id: string | null) => void
  onPick?: (id: string, key: string) => void
}

/** A window is reached by its band. */
function BandTargets({ bands, width, naming, onLight, onPick }: PickProps & { bands: PlacedBand[]; width: number }) {
  return bands.map(({ mark, top, bottom }) => (
    <button
      key={`hit:${mark.key}`}
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      className="group absolute top-0 left-0 cursor-pointer"
      style={{
        transform: `translate(${mark.x * width - 6}px, ${top - 8}px)`,
        width: Math.max(14, (mark.end - mark.x) * width + 12),
        height: bottom - top + 16,
      }}
      onClick={() => onPick?.(mark.routineId, mark.key)}
      onPointerEnter={() => onLight?.(mark.routineId)}
      onPointerLeave={() => onLight?.(null)}
    >
      <Tip text={`${naming.titleOf(mark.routineId)}, from ${naming.timeOf(mark.routineId, mark.at)}`} shown={false} />
    </button>
  ))
}

/** How close to an edge of the sky a mark's tip starts to lean inward. */
const TIP_ROOM = 120

interface MarksProps extends PickProps {
  points: PlacedMark[]
  now: number
  lit: string | null
  arriving: boolean
  /** The sky's width, so tips near its edges lean inward. */
  width?: number
}

/** Every point on the path: the runs that happened, and the times still to come. */
function Marks({ points, now, lit, arriving, width = Number.POSITIVE_INFINITY, naming, onLight, onPick }: MarksProps) {
  const next = points.find(({ mark }) => mark.kind === 'due' && mark.at > now)?.mark
  // The lit routine names its next time over its mark.
  const litNext = lit === null ? undefined : points.find(({ mark }) => mark.routineId === lit && mark.kind === 'due')?.mark
  const alignAt = (x: number): TipAlign => (x < TIP_ROOM ? 'start' : x > width - TIP_ROOM ? 'end' : 'center')

  return (
    <AnimatePresence>
      {points.map((point, index) => (
        <MarkButton
          key={point.mark.key}
          point={point}
          isNext={point.mark === next}
          named={point.mark === litNext}
          tipAlign={alignAt(point.x)}
          lit={lit}
          // A wave across the sky, from the earliest mark to the latest.
          delay={arriving ? staggerDelay + (index / points.length) * dur.travel : 0}
          naming={naming}
          onLight={onLight}
          onPick={onPick}
        />
      ))}
    </AnimatePresence>
  )
}

interface MarkButtonProps extends PickProps {
  point: PlacedMark
  isNext: boolean
  /** Its tip shows without the pointer, because its routine is lit. */
  named: boolean
  tipAlign: TipAlign
  lit: string | null
  delay: number
}

function MarkButton({ point, isNext, named, tipAlign, lit, delay, naming, onLight, onPick }: MarkButtonProps) {
  const { mark, x, y } = point
  const title = naming.titleOf(mark.routineId)
  const time = naming.timeOf(mark.routineId, mark.at)
  const dim = lit !== null && lit !== mark.routineId
  const scale = lit === mark.routineId ? 1.18 : 1
  const place = (lift: number, size: number) => `translateX(${x - 10}px) translateY(${y - 10 + lift}px) scale(${size})`

  let tip = `${title}, ${time}`
  let dot = <DueDot check={mark.kind === 'due' && mark.check} isNext={isNext} />
  if (mark.kind === 'ran') {
    const outcome = outcomeOf(mark)
    tip = `${title}, ${outcome.label.toLowerCase()}, ran ${time}`
    dot = <RanDot tone={outcome.tone} manual={mark.manual} />
  }

  return (
    <motion.button
      type="button"
      tabIndex={-1}
      aria-label={tip}
      className="group absolute top-0 left-0 grid size-5 cursor-pointer place-items-center"
      initial={{ opacity: 0, transform: place(8, 0.4) }}
      animate={{ opacity: dim ? 0.3 : 1, transform: place(0, scale) }}
      exit={{ opacity: 0, transform: place(0, 0.4), transition: tween.exit }}
      transition={{ transform: { ...spring.screen, delay }, opacity: { ...tween.enter, delay } }}
      onClick={() => onPick?.(mark.routineId, mark.key)}
      onPointerEnter={() => onLight?.(mark.routineId)}
      onPointerLeave={() => onLight?.(null)}
    >
      {dot}
      <Tip text={tip} shown={named} align={tipAlign} />
    </motion.button>
  )
}

/** A run that happened, coloured by how it went. One started by hand wears a ring. */
function RanDot({ tone, manual }: { tone: Tone; manual: boolean }) {
  return (
    <span
      className={cn(
        'block size-[9px] rounded-full shadow-[0_0_0_2px_var(--hb-tone-2)] transition-transform duration-[160ms] ease-out group-hover:scale-125',
        toneFill(tone),
        manual && 'ring-[1.5px] ring-foreground/60 ring-offset-0',
      )}
    />
  )
}

/** A time still to come: a small dot for a check of a window, a ring otherwise, and the next one in yellow with a ring that opens out. */
function DueDot({ check, isNext }: { check: boolean; isNext: boolean }) {
  if (isNext) {
    return (
      <span className="relative grid place-items-center">
        <span className="routines-ping absolute size-[13px] rounded-full bg-primary" />
        <span className="relative block size-[13px] rounded-full border-2 border-foreground bg-primary transition-transform duration-[160ms] ease-out group-hover:scale-125" />
      </span>
    )
  }
  if (check) return <span className="block size-1.5 rounded-full bg-foreground/45 transition-transform duration-[160ms] ease-out group-hover:scale-150" />
  return <span className="block size-2.5 rounded-full border-2 border-foreground/55 bg-tone-2 transition-transform duration-[160ms] ease-out group-hover:scale-125" />
}

/** Where a tip sits over its mark. Near an edge of the sky it leans inward, so it is never cut off. */
type TipAlign = 'start' | 'center' | 'end'

const TIP_ALIGN: Record<TipAlign, string> = {
  start: '-left-1',
  center: 'left-1/2 -translate-x-1/2',
  end: '-right-1',
}

/** The name and time over a mark, shown while the pointer is on it. */
function Tip({ text, shown, align = 'center' }: { text: string; shown: boolean; align?: TipAlign }) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute bottom-full mb-1 rounded-full bg-foreground px-2 py-0.5 font-heading text-[11px] leading-4 font-medium whitespace-nowrap text-background',
        'opacity-0 transition-opacity duration-[160ms] ease-[ease] group-hover:opacity-100',
        TIP_ALIGN[align],
        shown && 'opacity-100',
      )}
    >
      {text}
    </span>
  )
}

/** The times along the front hill. They crossfade when the sky changes between the day and the week. */
function TimeLabels({ labels, kind }: { labels: TimeLabel[]; kind: 'hours' | 'days' }) {
  return (
    <AnimatePresence initial={false}>
      <motion.div key={kind} className="pointer-events-none absolute inset-x-0 top-0" aria-hidden="true" {...crossfade}>
        {labels.map((label) => (
          <span key={label.key} className="absolute top-0 left-0" style={{ transform: `translate(${label.x}px, ${GROUND - 8}px)` }}>
            <span className={cn('block -translate-x-1/2 font-heading text-[10.5px] leading-4 whitespace-nowrap text-foreground/70', label.strong && 'font-semibold text-foreground')}>
              {label.text}
            </span>
          </span>
        ))}
      </motion.div>
    </AnimatePresence>
  )
}
