import { memo, useState, type PointerEvent } from 'react'
import { cn } from '@/lib/utils.ts'
import { ChartFrame, ReadoutItem } from './ChartFrame.tsx'
import { columnAt, SERIES_COLOR, stepColumn, type ChartStatus, type RatePoint } from './chart-kit.ts'
import { dayWords, shareWords, shortDay } from './format.ts'

export interface RateLineProps {
  id?: string
  title: string
  counts: string
  figure?: string
  /** One point for each run of days, oldest first: a week, or a day over a short period. */
  points: readonly RatePoint[]
  /** What the rate is of, in the readout: "first pass". */
  rateLabel?: string
  /** What the count under each point counts: "decided". */
  countLabel?: string
  status?: ChartStatus
  note?: string
  /** Makes the chart a button; it gets the point under the pointer or picked with Left and Right, or null for the whole period. */
  onOpen?: (point: RatePoint | null) => void
}

/** The plot's height, the row of counts under it and the dates under those, in pixels. Together they match `DayBars`. */
const PLOT = 100
const COUNTS = 16
const DATES = 16
const GUTTER = 36
const TICKS = [0, 0.5, 1]

const runWords = (point: RatePoint, today: string) => (point.from === point.to ? dayWords(point.from, today) : `${shortDay(point.from)} to ${point.to === today ? 'today' : shortDay(point.to)}`)

/**
 * A rate over time, 0 to 100%, one point for each run of days with how many it is a rate of under it. Where nothing
 * was under a rate the line has a gap and the point is not drawn, never a 0% or 100% of nothing. The readout says the
 * rate of the whole period, or of the point under the pointer or picked with Left and Right.
 */
export const RateLine = memo(function RateLine({ id, title, counts, figure, points, rateLabel = 'first pass', countLabel = 'decided', status = 'ready', note, onOpen }: RateLineProps) {
  const [active, setActive] = useState<number | null>(null)
  const count = points.length
  const ready = status === 'ready'
  const today = points.at(-1)?.to ?? ''
  const decided = points.reduce((total, point) => total + point.count, 0)
  const passed = points.reduce((total, point) => total + (point.rate ?? 0) * point.count, 0)
  const picked = active === null ? null : (points[active] ?? null)
  const rate = picked ? picked.rate : decided ? passed / decided : null
  const counted = picked ? picked.count : decided
  const heading = picked ? runWords(picked, today) : count ? `${shortDay(points[0]!.from)} to today` : ''
  const said = `${shareWords(rate)} ${rateLabel}, of ${counted} ${countLabel}`
  const gapWords = points.some((point) => point.rate === null) ? 'A gap means nothing was decided then. ' : ''
  const summary = ready ? `${heading}: ${said}. ${gapWords}Left and Right read each point.` : 'No numbers yet.'

  const onPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    setActive(columnAt(event.clientX - box.left, box.width, count))
  }

  return (
    <ChartFrame
      id={id}
      title={title}
      counts={counts}
      figure={ready ? figure : undefined}
      summary={summary}
      status={status}
      note={note}
      height={PLOT + COUNTS + DATES}
      readout={
        <>
          <span className="shrink-0 font-medium text-foreground">{heading}</span>
          <ReadoutItem color={SERIES_COLOR.line} line value={shareWords(rate)} label={rateLabel} />
          <span className="shrink-0 text-muted-foreground tabular-nums">
            of {counted} {countLabel}
          </span>
        </>
      }
      spoken={picked ? `${heading}: ${said}` : ''}
      onOpen={onOpen ? () => onOpen(picked) : undefined}
      onKey={(event) => {
        const next = stepColumn(event.key, active, count)
        if (next === null) return
        event.preventDefault()
        setActive(next)
      }}
      onFocus={() => setActive((at) => at ?? (count ? count - 1 : null))}
      onBlur={() => setActive(null)}
    >
      {(ready ? TICKS : [0]).map((tick) => (
        <div key={tick} className="absolute inset-x-0 flex items-center" style={{ bottom: COUNTS + DATES + tick * PLOT, transform: 'translateY(50%)' }}>
          <span className="shrink-0 pr-2 text-right text-[11px] leading-none text-muted-foreground tabular-nums" style={{ width: GUTTER }}>
            {ready ? `${tick * 100}%` : ''}
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>
      ))}
      {ready && count ? (
        <div className="absolute inset-y-0 grid" style={{ left: GUTTER, right: 0, gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }} onPointerMove={onPointer} onPointerLeave={() => setActive(null)}>
          <Segments points={points} />
          {points.map((point, index) => (
            <div key={point.from} className={cn('relative', index === active && 'bg-foreground/[0.06]')} style={{ gridColumn: index + 1, gridRow: 1 }}>
              {point.rate === null ? null : (
                <span
                  className={cn('absolute left-1/2 rounded-full ring-2 ring-surface', index === active ? 'size-2.5' : 'size-2')}
                  style={{ bottom: COUNTS + DATES + point.rate * PLOT, transform: 'translate(-50%, 50%)', background: SERIES_COLOR.line }}
                />
              )}
              <span className={cn('absolute inset-x-0 text-center text-[11px] leading-4 tabular-nums', index === active ? 'font-medium text-foreground' : 'text-muted-foreground')} style={{ bottom: DATES }}>
                {point.count}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {ready && count ? (
        <>
          <span className="absolute bottom-0 text-[11px] leading-4 text-muted-foreground" style={{ left: GUTTER }}>
            {shortDay(points[0]!.from)}
          </span>
          <span className="absolute right-0 bottom-0 text-[11px] leading-4 font-medium text-foreground">Today</span>
        </>
      ) : null}
    </ChartFrame>
  )
})

/** The line through the points, broken where a point has no rate. Drawn once; its stroke keeps 2px at any width. */
function Segments({ points }: { points: readonly RatePoint[] }) {
  const runs: string[] = []
  let run: string[] = []
  points.forEach((point, index) => {
    if (point.rate === null) {
      if (run.length > 1) runs.push(run.join(' '))
      run = []
      return
    }
    run.push(`${index + 0.5},${PLOT - point.rate * PLOT}`)
  })
  if (run.length > 1) runs.push(run.join(' '))
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute top-0 left-0 overflow-visible" style={{ width: '100%', height: PLOT }} viewBox={`0 0 ${points.length} ${PLOT}`} preserveAspectRatio="none">
      {runs.map((line) => (
        <polyline key={line} points={line} fill="none" stroke={SERIES_COLOR.line} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  )
}
