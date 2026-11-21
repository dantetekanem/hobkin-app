import { Check, Minus, X } from 'lucide-react'
import { useNow } from '@/features/chat/use-now.ts'
import { cn } from '@/lib/utils.ts'
import { tookAt, type StepLine, type StepState } from '../preparing-model.ts'

const MARK: Record<StepState, string> = {
  done: 'border-ok bg-ok/15 text-ok-fg',
  running: 'pv-breath border-primary bg-primary text-primary-foreground',
  waiting: 'border-border-strong/45 text-muted-foreground',
  skipped: 'border-border-strong/45 text-muted-foreground',
  failed: 'border-bad bg-bad/15 text-bad-fg',
}
const LABEL: Record<StepState, string> = {
  done: 'text-foreground',
  running: 'font-semibold text-foreground',
  waiting: 'text-muted-foreground',
  skipped: 'text-muted-foreground',
  failed: 'font-semibold text-bad-fg',
}
/** The words a screen reader hears for each mark. */
const SAYS: Record<StepState, string> = { done: 'Done', running: 'Running', waiting: 'Waiting', skipped: 'Skipped', failed: 'Failed' }

/** A step's time, the one part of the list that follows the clock: the running step counts its seconds, the rest hold still. */
function StepTime({ step }: { step: StepLine }) {
  const took = tookAt(step, useNow(step.since != null, 1000))
  return took ? <span className={cn('shrink-0 text-[14px] tabular-nums', step.status === 'running' ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{took}</span> : null
}

/**
 * Every step of the run, top to bottom on one line: the finished ones checked with how long they took, the running one
 * lit, with its time so far and how far through it is, the ones to come dim, and one that failed in red with why.
 */
export function Timeline({ steps }: { steps: StepLine[] }) {
  return (
    <ol aria-label="Steps" className="flex flex-col">
      {steps.map((step, index) => {
        const last = index === steps.length - 1
        const over = step.status === 'done' || step.status === 'skipped'
        return (
          <li key={step.id} data-step-status={step.status} aria-current={step.status === 'running' ? 'step' : undefined} className="flex gap-3">
            <div className="flex w-7 shrink-0 flex-col items-center">
              <span className={cn('relative grid size-7 shrink-0 place-items-center rounded-full border-2 font-heading text-[14px] font-semibold tabular-nums [&_svg]:size-4 [&_svg]:stroke-[2.75]', MARK[step.status])}>
                {step.status === 'done' ? <Check aria-hidden="true" /> : step.status === 'failed' ? <X aria-hidden="true" /> : step.status === 'skipped' ? <Minus aria-hidden="true" /> : step.status === 'running' ? <span aria-hidden="true" className="size-2 rounded-full bg-primary-foreground" /> : <span aria-hidden="true">{index + 1}</span>}
                <span className="sr-only">{SAYS[step.status]}: </span>
              </span>
              {last ? null : <span aria-hidden="true" className={cn('my-1 w-0.5 flex-1 rounded-full', over ? 'bg-ok/55' : 'bg-border')} />}
            </div>
            <div className={cn('mb-3 min-w-0 flex-1 rounded-xl px-3 py-1', step.status === 'running' && 'bg-sun/15', last && 'mb-0')}>
              <div className="flex items-baseline gap-3">
                <span className={cn('min-w-0 flex-1 text-[15px] leading-snug text-pretty', LABEL[step.status])}>{step.label}</span>
                <StepTime step={step} />
              </div>
              {step.count || step.note ? (
                <p className={cn('mt-0.5 text-[14px] leading-snug text-pretty [overflow-wrap:anywhere]', step.status === 'failed' ? 'text-bad-fg' : 'text-muted-foreground')}>
                  {step.count ? `${step.count} done` : null}
                  {step.count && step.note ? ' · ' : null}
                  {step.note ? (step.status === 'skipped' ? `Skipped: ${step.note}` : step.note) : null}
                </p>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
