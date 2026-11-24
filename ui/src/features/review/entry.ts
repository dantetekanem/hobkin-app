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
  /** Closes every open group of a large change, at once. False when none is open. */
  closeGroups?(): boolean
  /** The proof open beside the review (spec 053). */
  proof?: unknown
  closeProof?(): void
  /** When the proof and the code opened, as a count that goes up: the one opened last is the inner one. */
  proofAt?: number
  codeAt?: number
}

/**
 * Escape closes the innermost thing first: the note editor, the finder, the proof beside the review (or first the
 * code, with its selected lines, when the code opened after it), an open wire, selected lines, the code, then every open
 * group of a large change at once (spec 053), those the outline, U or a kept place opened by themselves too: one press,
 * never one for each. With the proof open it never leaves the review. Graph focus never traps the screen's exit.
 */
export function escapeReview(session: EscapableSession, close: () => void): void {
  const codeOverProof = session.code != null && (session.codeAt ?? 0) > (session.proofAt ?? 0)
  if (session.editor) session.closeEditor()
  else if (session.finder) session.closeFinder()
  else if (session.proof && session.closeProof && !codeOverProof) session.closeProof()
  else if (session.wire) session.openWire(null)
  else if (session.selection) session.selectLines(null)
  else if (session.code != null) session.closeCode()
  else if (!session.closeGroups?.()) close()
}

/**
 * Whether an Escape is the review's to take. One pressed in a field is the field's: it leaves the field and keeps its
 * words, and never closes the review. One in a dialog, a menu, a list or the stack's box is theirs too.
 */
export function reviewTakesEscape(target: { closest(selector: string): unknown }): boolean {
  return target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [data-rv-stack-box], [role="menu"], [role="listbox"]') == null
}
