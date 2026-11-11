/**
 * How much of a long box a transcript shows before it is opened. Nothing in a transcript scrolls by itself: a box is as
 * tall as what it shows, and a long one shows its first lines with a way to show all of them in place.
 */

/** Lines a box shows until it is opened. */
export const PREVIEW_LINES = 12
/** In code mode the calls are the thing read, so only a very long one is cut. */
export const CODE_PREVIEW_LINES = 40
/** A box only this many lines past its preview is shown whole: folding it would hide too little. */
const WORTH_FOLDING = 4

/**
 * How many lines of each part of a box are shown: all of them when it is open or only a few past the preview, and
 * otherwise the first `most` lines across the parts, in order.
 */
export function previewOf(sizes: readonly number[], open: boolean, most = PREVIEW_LINES): { shown: number[]; total: number; foldable: boolean } {
  const total = sizes.reduce((sum, size) => sum + size, 0)
  const foldable = total > most + WORTH_FOLDING
  if (open || !foldable) return { shown: [...sizes], total, foldable }
  let left = most
  const shown = sizes.map((size) => {
    const part = Math.min(size, left)
    left -= part
    return part
  })
  return { shown, total, foldable }
}
