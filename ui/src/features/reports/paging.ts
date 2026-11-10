/**
 * The Reports list draws a page at a time: a first page, then one more each time the scroll or the keyboard
 * comes near the end of what is drawn. Counts and filters always come from the data, never from what is drawn.
 * Pure, so the rules can be tested without a window. Spec: 012-reports-actions.
 */

/** How many reports the list draws at first, and how many more each time it reaches its end. */
export const PAGE = 40

/** How close to the last drawn row the keyboard may come before more are drawn, so the walk never waits. */
export const AHEAD = 8

/** How many rows a limit draws from a list of `total`. */
export function drawnCount(limit: number, total: number): number {
  return Math.max(0, Math.min(limit, total))
}

/** Whether more should be drawn now that the keyboard has reached row `index` of the `drawn` ones. */
export function needsMore(index: number, drawn: number, total: number, ahead = AHEAD): boolean {
  return index >= 0 && drawn < total && index >= drawn - ahead
}

/** One page more. A limit past the end of the list is harmless: it draws what there is. */
export function nextLimit(limit: number, page = PAGE): number {
  return limit + page
}

/** A limit that draws row `index`, such as a report opened from elsewhere, in whole pages. */
export function showing(index: number, limit: number, page = PAGE): number {
  if (index < limit) return limit
  return (Math.floor(index / page) + 1) * page
}

/** Rows past the first page arrive by paging, so they land without an entrance and scrolling never stutters. */
export function arrivesQuietly(index: number, page = PAGE): boolean {
  return index >= page
}
