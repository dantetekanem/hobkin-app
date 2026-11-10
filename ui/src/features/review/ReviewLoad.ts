import { createElement, useSyncExternalStore, type ReactNode } from 'react'
import type { Review } from '#shared/review/types.ts'
import type { ReviewLoader } from './loader.ts'

/** The real screen and focused render tests share this boundary, not a parallel selector. */
export function ReviewLoad({ loader, renderReview, renderWaiting }: {
  loader: ReviewLoader
  renderReview: (review: Review) => ReactNode
  renderWaiting?: (status: string, reason: string | null) => ReactNode
}) {
  const state = useSyncExternalStore(loader.subscribe, loader.getState, loader.getState)
  const message = state.notesError ? `Notes are saved on this device, but the host did not save them: ${state.notesError}` : state.error ?? (state.preparation?.phase ? `Preparing review: ${state.preparation.phase}` : null)
  return createElement('div', { className: 'relative h-full' },
    state.review ? renderReview(state.review) : renderWaiting?.(state.status, state.error),
    createElement('div', { className: 'absolute right-4 top-28 z-30 flex max-w-sm flex-col items-end gap-2' },
      message ? createElement('p', { role: 'status', className: 'rounded-lg bg-card p-3 text-sm text-muted-foreground' }, message) : null,
      createElement('button', { type: 'button', className: 'rounded-lg border bg-card px-3 py-2 text-sm', onClick: () => void (state.notesError ? loader.flushNotes() : loader.refresh()) }, state.notesError ? 'Retry saving notes' : 'Refresh review')))
}
