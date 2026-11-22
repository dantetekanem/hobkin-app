import { memo } from 'react'
import { ChartFrame } from './ChartFrame.tsx'
import { stepColor, type ChartStatus, type FunnelStep } from './chart-kit.ts'
import { countWords } from './format.ts'

export interface FunnelProps {
  id?: string
  title: string
  counts: string
  figure?: string
  /** The gates in order, from what entered to what came out: finished, rated 8 or more, models hold, merged by itself. */
  steps: readonly FunnelStep[]
  /** What left at the end another way, said after the last gate: "14 waited for you". */
  aside?: { label: string; count: number }
  status?: ChartStatus
  note?: string
  /** Makes the funnel a button that opens what it counts. */
  onOpen?: () => void
}

const ROW = 28

/**
 * How many passed each gate, as the YOLO sketch has it: one bar for each gate, as long as its count against the first,
 * the count at its end and how many the gate held back. The bars go light to dark in one hue, so their order shows.
 * Its box is as tall as its gates, whatever their counts.
 */
export const Funnel = memo(function Funnel({ id, title, counts, figure, steps, aside, status = 'ready', note, onOpen }: FunnelProps) {
  const ready = status === 'ready'
  const first = steps[0]?.count ?? 0
  const last = steps.at(-1)
  const ending = !ready ? (status === 'loading' ? 'Reading the numbers…' : (note ?? 'No data yet.')) : last ? `Of ${countWords(first)} ${steps[0]!.label.toLowerCase()}, ${countWords(last.count)} ${last.label.toLowerCase()}${aside ? ` and ${countWords(aside.count)} ${aside.label}` : ''}.` : ''
  const summary = ready ? `${steps.map((step) => `${countWords(step.count)} ${step.label.toLowerCase()}`).join(', then ')}.${aside ? ` ${countWords(aside.count)} ${aside.label}.` : ''}` : 'No numbers yet.'
  return (
    <ChartFrame id={id} title={title} counts={counts} figure={ready ? figure : undefined} summary={summary} status={status} note={note} height={steps.length * ROW + 24} wordsInBox={false} onOpen={onOpen}>
      <ol className="flex flex-col">
        {steps.map((step, index) => {
          const held = index > 0 ? steps[index - 1]!.count - step.count : 0
          return (
            <li key={step.key} className="grid items-center gap-x-3" style={{ height: ROW, gridTemplateColumns: 'minmax(96px, 9rem) minmax(0, 1fr) 44px 44px' }}>
              <span className="truncate text-[12.5px] text-muted-foreground">{step.label}</span>
              <span className="h-3">
                {ready && step.count > 0 && first > 0 ? <span className="block h-full rounded-r-[4px]" style={{ width: `max(2px, ${(step.count / first) * 100}%)`, background: stepColor(index, steps.length) }} /> : null}
              </span>
              <span className="text-right text-[13px] font-semibold tabular-nums">{ready ? countWords(step.count) : ''}</span>
              <span className="text-right text-[12px] text-muted-foreground tabular-nums">{ready && held > 0 ? `−${countWords(held)}` : ''}</span>
            </li>
          )
        })}
      </ol>
      <p className="absolute inset-x-0 bottom-0 h-5 truncate text-[12.5px] leading-5 text-muted-foreground">{ending}</p>
    </ChartFrame>
  )
})
