/**
 * How much of a long box a transcript shows before it is opened. A long one shows its first lines with a way to show
 * more of them, and a box never grows past one height (`.aa-box`): past it, it scrolls inside. A big one opens two
 * hundred lines at a time, so a file of thousands of lines never draws them all at once.
 */

/** Lines a box shows until it is opened. */
export const PREVIEW_LINES = 12
/** Lines each press draws once a box is opened. */
export const OPEN_LINES = 200
/** A box only this many lines past what is drawn is shown whole: folding it would hide too little. */
const WORTH_FOLDING = 4

/**
 * How many lines of each part of a box are drawn after `presses` presses (none: closed): the first `most` lines across
 * the parts in order, two hundred more for each press, and all of them once only a few would be left. `left` is how
 * many are not drawn, and `next` how many the next press draws.
 */
export function previewOf(sizes: readonly number[], presses: number, most = PREVIEW_LINES): { shown: number[]; total: number; foldable: boolean; left: number; next: number } {
  const total = sizes.reduce((sum, size) => sum + size, 0)
  const foldable = total > most + WORTH_FOLDING
  const reach = most + presses * OPEN_LINES
  if (!foldable || reach + WORTH_FOLDING >= total) return { shown: [...sizes], total, foldable, left: 0, next: 0 }
  let rest = reach
  const shown = sizes.map((size) => {
    const part = Math.min(size, rest)
    rest -= part
    return part
  })
  const left = total - reach
  return { shown, total, foldable, left, next: reach + OPEN_LINES + WORTH_FOLDING >= total ? left : OPEN_LINES }
}
