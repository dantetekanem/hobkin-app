import { reviewIdOf, targetOfReviewId } from '#shared/review/ids.ts'

/** Sample cards never resolve to a host target. Live cards always name their actual change. */
export function finishedReviewId(change: { slug: string; item: string }, live: boolean): string | null {
  if (!live) return 'sample'
  const id = reviewIdOf({ kind: 'change', ...change })
  return targetOfReviewId(id) ? id : null
}

/** Child editors and popovers leave first. Graph focus and code panes never trap the screen's exit. */
export function escapeReview(session: { editor: unknown; finder: boolean; wire: string | null; closeEditor(): void; closeFinder(): void; openWire(id: string | null): void }, close: () => void): void {
  if (session.editor) session.closeEditor()
  else if (session.finder) session.closeFinder()
  else if (session.wire) session.openWire(null)
  else close()
}
