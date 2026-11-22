import { memo, useState, type PointerEvent } from 'react'
import { cn } from '@/lib/utils.ts'
import { ChartFrame, ReadoutItem } from './ChartFrame.tsx'
import { columnAt, niceMax, stepColumn, ticksOf, type ChartStatus, type DaySeries } from './chart-kit.ts'
import { countWords, dayWords, shortDay } from './format.ts'

export interface DayBarsProps {
  id?: string
  title: string
  /** The sentence that says what the chart counts. */
  counts: string
  figure?: string
  /** The days drawn, `YYYY-MM-DD`, oldest first; the newest is today. */
  days: readonly string[]
  /** Up to three series, stacked from the base up, each with a value for each day. */
  series: readonly DaySeries[]
  /** A series drawn as a line over the bars, such as the changes declined. */
  line?: DaySeries
  /** How a value reads: a count by default, `tokenWords` for tokens. */
  words?: (value: number) => string
  status?: ChartStatus
  note?: string
  /** Makes the chart a button; it gets the day under the pointer or picked with Left and Right, or null for the whole period. */
  onOpen?: (day: string | null) => void
}

/** The bars' height, the x axis under them and the y axis' labels at the left, in pixels. */
const PLOT = 112
const AXIS = 20
const GUTTER = 36

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)
/** Where the middle of column `index` of `count` sits, across the plot right of the y axis. */
const centerOf = (index: number, count: number) => `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${(index + 0.5) / count})`

/**
 * Stacked bars, one for each day, with up to three series and an optional line, as Home's week bars are drawn: HTML
 * boxes, a 2px gap between the parts of a bar, a 4px round top. The y axis has three round ticks, the x axis the
 * first day, the middle one and today. The readout names each series with its total, or the day under the pointer or
 * picked with Left and Right. Nothing on it moves by itself.
 */
export const DayBars = memo(function DayBars({ id, title, counts, figure, days, series, line, words = countWords, status = 'ready', note, onOpen }: DayBarsProps) {
  const [active, setActive] = useState<number | null>(null)
  const count = days.length
  const totals = days.map((_, index) => series.reduce((total, one) => total + (one.values[index] ?? 0), 0))
  const top = niceMax(Math.max(0, ...totals, ...(line?.values ?? [])))
  const ticks = ticksOf(top)
  const ready = status === 'ready'
  const nothing = ready && totals.every((total) => total === 0) && (line?.values.every((value) => value === 0) ?? true)
  const today = days.at(-1) ?? ''
  const shown = [...series.map((one) => ({ one, line: false })), ...(line ? [{ one: line, line: true }] : [])]
  const valueOf = (one: DaySeries) => (active === null ? sum(one.values) : (one.values[active] ?? 0))
  const heading = active === null ? `Last ${count} days` : dayWords(days[active]!, today)
  const most = totals.reduce((best, total, index) => (total > totals[best]! ? index : best), 0)
  const summary = !ready
    ? 'No numbers yet.'
    : `Last ${count} days: ${shown.map(({ one }) => `${words(sum(one.values))} ${one.label}`).join(', ')}.${nothing ? '' : ` Most in a day: ${words(totals[most]!)}, ${dayWords(days[most]!, today)}.`} Left and Right read each day.`

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
      height={PLOT + AXIS}
      readout={
        <>
          <span className="shrink-0 font-medium text-foreground">{heading}</span>
          {shown.map(({ one, line: drawn }) => (
            <ReadoutItem key={one.key} color={one.color} line={drawn} value={words(valueOf(one))} label={one.label} />
          ))}
        </>
      }
      spoken={active === null ? '' : `${heading}: ${shown.map(({ one }) => `${words(valueOf(one))} ${one.label}`).join(', ')}`}
      onOpen={onOpen ? () => onOpen(active === null ? null : (days[active] ?? null)) : undefined}
      onKey={(event) => {
        const next = stepColumn(event.key, active, count)
        if (next === null) return
        event.preventDefault()
        setActive(next)
      }}
      onFocus={() => setActive((at) => at ?? (count ? count - 1 : null))}
      onBlur={() => setActive(null)}
    >
      {(ready ? ticks : [0]).map((tick) => (
        <div key={tick} className="absolute inset-x-0 flex items-center" style={{ bottom: AXIS + (tick / top) * PLOT, transform: 'translateY(50%)' }}>
          <span className="shrink-0 pr-2 text-right text-[11px] leading-none text-muted-foreground tabular-nums" style={{ width: GUTTER }}>
            {ready ? words(tick) : ''}
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>
      ))}
      {ready && !nothing ? (
        <>
          <div
            className="absolute top-0 grid"
            style={{ left: GUTTER, right: 0, height: PLOT, gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
            onPointerMove={onPointer}
            onPointerLeave={() => setActive(null)}
          >
            {days.map((day, index) => (
              <Column key={day} values={series.map((one) => one.values[index] ?? 0)} colors={series.map((one) => one.color)} total={totals[index]!} top={top} active={index === active} thin={count > 31} />
            ))}
          </div>
          {line ? <Line values={line.values} color={line.color} top={top} /> : null}
          {line && active !== null ? (
            <span
              className="pointer-events-none absolute size-2 rounded-full ring-2 ring-surface"
              style={{ left: centerOf(active, count), bottom: AXIS + ((line.values[active] ?? 0) / top) * PLOT, transform: 'translate(-50%, 50%)', background: line.color }}
            />
          ) : null}
        </>
      ) : null}
      {nothing ? <span className="absolute grid place-items-center text-[13px] text-muted-foreground" style={{ left: GUTTER, right: 0, top: 0, height: PLOT }}>Nothing in these {count} days.</span> : null}
      {ready && count ? <DayAxis days={days} /> : null}
    </ChartFrame>
  )
})

/** One day's bar: its parts from the base up, a 2px gap between them, a round top, square at the base. */
function Column({ values, colors, total, top, active, thin }: { values: number[]; colors: string[]; total: number; top: number; active: boolean; thin: boolean }) {
  const upper = values.findLastIndex((value) => value > 0)
  return (
    <div className={cn('flex h-full flex-col justify-end', active && 'bg-foreground/[0.06]')}>
      {total > 0 ? (
        <div className={cn('mx-auto flex w-[calc(100%-2px)] max-w-6 flex-col-reverse overflow-hidden', thin ? 'rounded-t-[2px]' : 'rounded-t-[4px]')} style={{ height: `${(total / top) * 100}%` }}>
          {values.map((value, index) =>
            value > 0 ? <span key={index} className={cn('block w-full shrink-0 bg-clip-content', index !== upper && 'pt-[2px]')} style={{ height: `${(value / total) * 100}%`, backgroundColor: colors[index] }} /> : null,
          )}
        </div>
      ) : null}
    </div>
  )
}

/** A line over the bars, through the middle of each day. It is drawn once and keeps its 2px at any width. */
function Line({ values, color, top }: { values: readonly number[]; color: string; top: number }) {
  const points = values.map((value, index) => `${index + 0.5},${PLOT - (value / top) * PLOT}`).join(' ')
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute top-0 overflow-visible" style={{ left: GUTTER, width: `calc(100% - ${GUTTER}px)`, height: PLOT }} viewBox={`0 0 ${values.length} ${PLOT}`} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** The first day, the middle one and today under the bars. */
function DayAxis({ days }: { days: readonly string[] }) {
  const count = days.length
  const middle = Math.floor((count - 1) / 2)
  const label = 'absolute bottom-0 text-[11px] leading-4 whitespace-nowrap text-muted-foreground'
  return (
    <>
      {count > 2 ? <span className={label} style={{ left: GUTTER }}>{shortDay(days[0]!)}</span> : null}
      {count > 4 ? <span className={label} style={{ left: centerOf(middle, count), transform: 'translateX(-50%)' }}>{shortDay(days[middle]!)}</span> : null}
      <span className={cn(label, 'right-0 font-medium text-foreground')}>Today</span>
    </>
  )
}
