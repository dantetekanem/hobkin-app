import { createElement, useSyncExternalStore, type ReactNode } from 'react'
import type { ReviewStatus } from '#shared/review/status.ts'
import type { Review } from '#shared/review/types.ts'
import { waitsForReview, type ReviewLoader } from './loader.ts'
import { failureOf, underWay } from './preparing-model.ts'
import type { ReviewLook } from './state/look.ts'

/** The real screen and focused render tests share this boundary, not a parallel selector. */
export function ReviewLoad({ loader, renderReview, renderWaiting, renderRun, renderBeside }: {
  loader: ReviewLoader
  renderReview: (review: Review) => ReactNode
  /** What shows until the review opens, for the look it opens in. */
  renderWaiting?: (status: string, reason: string | null, look: ReviewLook) => ReactNode
  /** A run over the open review, or why the last one stopped: shown in the corner, in place of "Refresh review". */
  renderRun?: () => ReactNode
  /** The corner's bottom row for the open review: what stands beside "Refresh review", given the button (null when it is hidden) so it keeps its place. */
  renderBeside?: (review: Review, preparation: ReviewStatus | null, action: ReactNode) => ReactNode
}) {
  const state = useSyncExternalStore(loader.subscribe, loader.getState, loader.getState)
  const message = state.notesError
    ? `Notes are saved on this device, but the host did not save them: ${state.notesError}`
    : state.error
  const waitingForStart = state.status === 'awaiting' || state.status === 'preparing'
  const retryNotes = Boolean(state.notesError)
  // A change that lands is done with: nothing is run over its review, and nothing offers to build it again.
  const landing = state.preparation?.landing != null
  // Nothing floats over the code in the code look, and the graph look that waits for its change review shows that run
  // itself (spec 071): neither has the run, "Refresh review" or what stands beside it. Notes can still be saved again.
  const quiet = state.look === 'code' || waitsForReview(state)
  const run = state.review && renderRun && !quiet && !landing && (underWay(state.preparation) || failureOf(state.preparation)) ? renderRun() : null

  const refresh = waitingForStart || ((quiet || run || landing) && !retryNotes) ? null : createElement('button', {
    type: 'button',
    className: 'rounded-lg border bg-card px-3 py-2 text-sm whitespace-nowrap',
    onClick: () => void (retryNotes ? loader.flushNotes() : loader.refresh()),
  }, retryNotes ? 'Retry saving notes' : 'Refresh review')

  return createElement('div', { className: 'relative h-full', 'data-rv-load': '' },
    state.review ? renderReview(state.review) : renderWaiting?.(state.status, state.error, state.look),
    createElement('div', { className: 'absolute right-4 top-28 z-30 flex max-w-sm flex-col items-end gap-2' },
      message ? createElement('p', { role: 'status', className: 'rounded-lg bg-card p-3 text-sm text-muted-foreground' }, message) : null,
      run,
      state.review && renderBeside && !quiet ? renderBeside(state.review, state.preparation, refresh) : refresh))
}
