import { reviewIdOf, targetOfReviewId } from '#shared/review/ids.ts'

/** Sample cards never resolve to a host target. Live cards always name their actual change. */
export function finishedReviewId(change: { slug: string; item: string }, live: boolean): string | null {
  if (!live) return 'sample'
  const id = reviewIdOf({ kind: 'change', ...change })
  return targetOfReviewId(id) ? id : null
}

interface EscapableSession {
  editor: unknown
  finder: boolean
  wire: string | null
  code: string | null
  selection: unknown
  closeEditor(): void
  closeFinder(): void
  openWire(id: string | null): void
  selectLines(selection: null): void
  closeCode(): void
}

/** Escape closes the innermost thing first: the note editor, the finder, an open wire, selected lines, then the code. Graph focus never traps the screen's exit. */
export function escapeReview(session: EscapableSession, close: () => void): void {
  if (session.editor) session.closeEditor()
  else if (session.finder) session.closeFinder()
  else if (session.wire) session.openWire(null)
  else if (session.selection) session.selectLines(null)
  else if (session.code != null) session.closeCode()
  else close()
}

/**
 * Whether an Escape is the review's to take. One pressed in a field is the field's: it leaves the field and keeps its
 * words, and never closes the review. One in a dialog, a menu or a list is theirs too.
 */
export function reviewTakesEscape(target: { closest(selector: string): unknown }): boolean {
  return target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"]') == null
}
