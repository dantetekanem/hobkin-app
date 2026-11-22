import { useId, type KeyboardEvent, type ReactNode } from 'react'
import { OpenArrow } from '@/components/ui/open-arrow.tsx'
import { cn } from '@/lib/utils.ts'
import type { ChartStatus } from './chart-kit.ts'

/**
 * The card every chart sits in: its title and figure, the sentence that says what it counts, a readout line, and the
 * plot in a box of fixed height, so nothing moves while the numbers load or when they change. Given `onOpen`, the
 * card is a button (`pressable`, with the open arrow): a click or Enter opens what it counts. The plot is one stop of
 * the Up and Down walk; Left and Right are the chart's own (`onKey`). Its accessible name is the title and `summary`;
 * what the readout says is spoken as it changes.
 */
export interface ChartFrameProps {
  id?: string
  title: string
  /** The sentence that says what the chart counts. */
  counts: string
  /** The chart's figure, beside its title. */
  figure?: string
  /** What the chart shows, in a sentence or two, for a reader who cannot see it. */
  summary: string
  status: ChartStatus
  /** The words a chart with no numbers shows in its box. */
  note?: string
  /** The plot's height in pixels, its axis included. */
  height: number
  /** The line above the plot that names the series and reads the day under the pointer. Its place is always kept. */
  readout?: ReactNode
  /** The readout in words, spoken while it reads one day. */
  spoken?: string
  /** False when the chart says itself why it has no marks, as a funnel does on its last line. */
  wordsInBox?: boolean
  onOpen?: () => void
  onKey?: (event: KeyboardEvent<HTMLElement>) => void
  onFocus?: () => void
  onBlur?: () => void
  children: ReactNode
}

/**
 * What makes a box act on a click: given `onOpen`, it is a button that a click, Enter or Space opens, and a stop of the
 * Up and Down walk; otherwise a group. A box rather than a `<button>`, because WebKit lays a button's content out in a
 * box of its own that the card's flex column and fixed heights do not reach. `onKey` takes every other key.
 */
export function pressProps(onOpen: (() => void) | undefined, onKey?: (event: KeyboardEvent<HTMLElement>) => void) {
  return {
    role: onOpen ? 'button' : 'group',
    tabIndex: onOpen || onKey ? 0 : undefined,
    'data-stop': onOpen || onKey ? '' : undefined,
    onClick: onOpen,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (onOpen && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault()
        onOpen()
        return
      }
      onKey?.(event)
    },
  } as const
}

export function ChartFrame({ id, title, counts, figure, summary, status, note, height, readout, spoken, wordsInBox = true, onOpen, onKey, onFocus, onBlur, children }: ChartFrameProps) {
  const said = useId()
  return (
    <figure id={id} className="m-0 min-w-0">
      <div
        {...pressProps(onOpen, onKey ?? (() => {}))}
        aria-label={`${title}. ${summary}`}
        aria-describedby={said}
        onFocus={onFocus}
        onBlur={onBlur}
        className={cn('flex min-w-0 flex-col gap-2 rounded-2xl bg-surface px-4 py-3 text-left select-none', onOpen && 'pressable')}
      >
        <div className="flex h-6 min-w-0 items-center gap-3">
          <h3 className="shrink-0 font-heading text-[13.5px] font-semibold">{title}</h3>
          {figure ? <span className="min-w-0 flex-1 truncate text-right text-[12.5px] text-muted-foreground tabular-nums">{figure}</span> : <span className="flex-1" />}
          {onOpen ? <OpenArrow className="size-3.5" /> : null}
        </div>
        <p id={said} className="line-clamp-2 h-9 text-[12.5px] leading-[18px] text-muted-foreground">
          {counts}
        </p>
        {readout !== undefined ? (
          <div aria-hidden="true" className="flex h-5 min-w-0 items-center gap-3 overflow-hidden text-[12px] whitespace-nowrap">
            {status === 'ready' ? readout : null}
          </div>
        ) : null}
        <div aria-hidden="true" className="relative" style={{ height }}>
          {children}
          {status === 'ready' || !wordsInBox ? null : <BoxWords status={status} note={note} />}
        </div>
      </div>
      <p aria-live="polite" className="sr-only">
        {spoken ?? ''}
      </p>
    </figure>
  )
}

/** What a box with no marks says: that the numbers are being read, or why there are none. */
export function BoxWords({ status, note }: { status: ChartStatus; note?: string }) {
  return <span className="absolute inset-0 grid place-items-center px-4 text-center text-[13px] text-muted-foreground">{status === 'loading' ? 'Reading the numbers…' : (note ?? 'No data yet.')}</span>
}

/** The mark beside a series' name: a block for bars, a short stroke for a line. Identity never rests on color alone: the name is beside it. */
export function SeriesKey({ color, line = false }: { color: string; line?: boolean }) {
  return line ? <span className="h-0.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} /> : <span className="size-2 shrink-0 rounded-[2px]" style={{ background: color }} />
}

/** One series in a readout: its key, its value first, then its name. */
export function ReadoutItem({ color, line, value, label }: { color: string; line?: boolean; value: string; label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <SeriesKey color={color} line={line} />
      <span className="font-medium text-foreground tabular-nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  )
}
