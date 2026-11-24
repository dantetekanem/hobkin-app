import type { ReactNode } from 'react'
import type { ReviewStatus } from '#shared/review/status.ts'
import type { Review } from '#shared/review/types.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/utils.ts'
import { refreshCodeButton } from './refresh-code.ts'
import { stackButton } from './stack-start.ts'
import { useRefreshCode } from './use-refresh-code.ts'
import { useStackStart } from './use-stack-start.ts'

/**
 * The review's bottom corner row (spec 060): "Make it a stack" to the left of "Refresh review", drawn like it, so the two
 * read as a pair. The stack button is there only for a change above 300 lines that has not merged, and the action keeps
 * its place whether or not it is. Its words hold one width: "Starting…" lies over the same place while the host is asked.
 * A refusal is a status card above the row, and goes on the next press. Shift+S puts the keyboard on the button.
 */
export function StackCorner({ review, preparation, live, action }: { review: Review; preparation: ReviewStatus | null; live: boolean; action: ReactNode }) {
  const { busy, error, press } = useStackStart(review.id, live)
  const merged = preparation?.landing?.state === 'merged'
  const button = stackButton({ merged, busy, lines: review.change.additions + review.change.deletions })
  const code = useRefreshCode(review.id, live)
  const stale = refreshCodeButton({ merged, busy: code.busy, code: preparation?.code })
  return (
    <>
      {error || code.error ? (
        <p role="status" className="rounded-lg bg-card p-3 text-sm text-muted-foreground">
          {error ?? code.error}
        </p>
      ) : null}
      {button.shown || stale.shown || action ? (
        <div className="flex items-center gap-2">
          {stale.shown ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    data-stop
                    data-rv-refresh-code
                    aria-disabled={stale.busy}
                    onClick={() => void code.press()}
                    className={cn('rounded-lg border bg-card px-3 py-2 text-sm whitespace-nowrap', stale.busy && 'opacity-60')}
                  >
                    <span className="grid justify-items-center">
                      <span className={cn('col-start-1 row-start-1', stale.busy && 'invisible')}>Code stale · Refresh</span>
                      <span className={cn('col-start-1 row-start-1', !stale.busy && 'invisible')}>Starting…</span>
                    </span>
                  </button>
                }
              />
              <TooltipContent sideOffset={6}>{stale.tooltip}</TooltipContent>
            </Tooltip>
          ) : null}
          {button.shown ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    data-stop
                    data-rv-stack
                    aria-disabled={button.busy}
                    onClick={() => void press()}
                    className={cn('rounded-lg border bg-card px-3 py-2 text-sm whitespace-nowrap', button.busy && 'opacity-60')}
                  >
                    <span className="grid justify-items-center">
                      <span className={cn('col-start-1 row-start-1', button.busy && 'invisible')}>Make it a stack</span>
                      <span className={cn('col-start-1 row-start-1', !button.busy && 'invisible')}>Starting…</span>
                    </span>
                  </button>
                }
              />
              <TooltipContent sideOffset={6}>
                {button.tooltip} <Kbd>⇧S</Kbd>
              </TooltipContent>
            </Tooltip>
          ) : null}
          {action}
        </div>
      ) : null}
    </>
  )
}
