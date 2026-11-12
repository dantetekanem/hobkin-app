import { useStore } from 'zustand'
import { Button } from '@/components/ui/button.tsx'
import { useNow } from '@/features/chat/use-now.ts'
import type { ReviewLoader } from './loader.ts'
import { preparingOf, type StepLine } from './preparing-model.ts'

const MARK: Record<StepLine['status'], string> = { done: '✓', running: '…', waiting: '·', failed: '✗' }

/**
 * The review window while a review is queued or running, and the page that waits for "Start AI review" on a pull
 * request. It says the window can be closed, how long it has taken, what is happening now, and every step.
 */
export function Preparing({ loader, closeReview }: { loader: ReviewLoader; closeReview: () => void }) {
  const status = useStore(loader, (state) => state.status)
  const preparation = useStore(loader, (state) => state.preparation)
  const startedAt = useStore(loader, (state) => state.startedAt)
  const now = useNow(status === 'preparing', 1000)

  if (status === 'awaiting') {
    return (
      <div className="grid h-full place-items-center p-8 pt-20">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <p className="font-heading text-[20px] font-semibold tracking-[-0.02em]">This pull request has not been reviewed yet</p>
          <p className="text-[15px] text-pretty text-muted-foreground">hobkin reads the change and tells you what to look at. It runs in the background.</p>
          <Button data-stop="" onClick={() => void loader.start()}>Start AI review</Button>
        </div>
      </div>
    )
  }

  const view = preparingOf(preparation, startedAt, now)
  return (
    <div className="grid h-full place-items-center overflow-y-auto p-8 pt-20">
      <div className="flex w-full max-w-lg flex-col gap-4">
        <p className="font-heading text-[20px] font-semibold tracking-[-0.02em]">Preparing the review</p>
        <p className="text-[15px] text-pretty text-muted-foreground">You can close this window. The review will be ready in the background, and hobkin will tell you in the chat.</p>
        <div role="status" aria-live="polite" className="rounded-2xl bg-tone-1 px-4 py-3">
          <p className="text-[14px] font-medium">{view.now}</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground tabular-nums">
            {view.percent == null ? null : `${view.percent}% · `}
            {view.elapsed ? `${view.elapsed} so far` : 'Just started'}
            {view.left ? ` · about ${view.left} left` : null}
          </p>
        </div>
        {view.steps.length ? (
          <ol aria-label="Steps" className="flex flex-col gap-1 text-[13px]">
            {view.steps.map((step) => (
              <li key={step.id} className="flex items-baseline gap-2" data-step-status={step.status}>
                <span aria-hidden="true" className="w-4 text-center text-muted-foreground">{MARK[step.status]}</span>
                <span className={step.status === 'running' ? 'font-medium' : step.status === 'waiting' ? 'text-muted-foreground' : ''}>{step.label}</span>
                {step.took ? <span className="ml-auto text-muted-foreground tabular-nums">{step.took}</span> : null}
              </li>
            ))}
          </ol>
        ) : null}
        <div>
          <Button variant="outline" onClick={closeReview}>Close and keep it running</Button>
        </div>
      </div>
    </div>
  )
}
