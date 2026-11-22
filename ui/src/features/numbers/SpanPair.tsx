import { memo, useId } from 'react'
import type { MetricsSpan } from '#shared/protocol/metrics.ts'
import { OpenArrow } from '@/components/ui/open-arrow.tsx'
import { cn } from '@/lib/utils.ts'
import type { ChartStatus } from './chart-kit.ts'
import { NO_DATA, spanWords } from './format.ts'

export interface SpanPairProps {
  id?: string
  title: string
  /** The sentence that says what is measured. */
  counts: string
  span: MetricsSpan | null
  /** What each measure is of, after its count: "measured". */
  countLabel?: string
  status?: ChartStatus
  note?: string
  /** Makes the card a button that opens what it measures. */
  onOpen?: () => void
}

/**
 * How long something takes, as two figures: the median, and the time 9 in 10 finish within (p90), with how many were
 * measured. Nothing measured reads "no data yet". A card of one size whatever it holds; two stacked are as tall as a
 * chart beside them.
 */
export const SpanPair = memo(function SpanPair({ id, title, counts, span, countLabel = 'measured', status = 'ready', note, onOpen }: SpanPairProps) {
  const said = useId()
  const ready = status === 'ready'
  const measured = ready && span !== null && span.count > 0
  const name = !ready ? `${title}: ${status === 'loading' ? 'reading the numbers' : (note ?? NO_DATA)}` : measured ? `${title}: median ${spanWords(span.median)}, 9 in 10 within ${spanWords(span.p90)}, of ${span.count} ${countLabel}` : `${title}: ${NO_DATA}`
  const body = (
    <>
      <span className="flex h-6 min-w-0 items-center gap-3">
        <span className="shrink-0 font-heading text-[13.5px] font-semibold">{title}</span>
        <span className="min-w-0 flex-1 truncate text-right text-[12.5px] text-muted-foreground tabular-nums">{measured ? `of ${span.count} ${countLabel}` : ''}</span>
        {onOpen ? <OpenArrow className="size-3.5" /> : null}
      </span>
      <span id={said} title={counts} className="h-5 truncate text-[12.5px] leading-5 text-muted-foreground">
        {counts}
      </span>
      <span className="mt-auto flex h-10 min-w-0 items-end gap-6">
        {ready ? (
          <>
            <Figure label="Median" value={measured ? spanWords(span.median) : NO_DATA} />
            <Figure label="9 in 10 within" value={measured ? spanWords(span.p90) : NO_DATA} />
          </>
        ) : (
          <span className="text-[13px] leading-6 text-muted-foreground">{status === 'loading' ? 'Reading the numbers…' : (note ?? 'No data yet.')}</span>
        )}
      </span>
    </>
  )
  // The box is a plain block with the column inside at its own height: WebKit lays a button's content out in a box of
// its own, where neither a flex column nor a height in percent reaches the button's height.
  const box = 'block h-[124px] w-full min-w-0 rounded-2xl bg-background px-4 py-3 text-left select-none'
  return (
    <figure id={id} className="m-0 min-w-0">
      {onOpen ? (
        <button type="button" data-stop="" aria-label={name} aria-describedby={said} onClick={onOpen} className={cn(box, 'pressable')}>
          <span className="flex h-[100px] min-w-0 flex-col gap-1">{body}</span>
        </button>
      ) : (
        <div role="group" aria-label={name} aria-describedby={said} className={box}>
          <span className="flex h-[100px] min-w-0 flex-col gap-1">{body}</span>
        </div>
      )}
    </figure>
  )
})

function Figure({ label, value }: { label: string; value: string }) {
  const known = value !== NO_DATA
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-[11.5px] leading-4 text-muted-foreground">{label}</span>
      <span className={cn('truncate leading-6', known ? 'font-heading text-[20px] font-semibold tracking-[-0.02em] [font-variant-numeric:normal]' : 'text-[13px] text-muted-foreground')}>{value}</span>
    </span>
  )
}
