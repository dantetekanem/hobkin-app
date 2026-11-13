/** A stretch of a list, in the list's own positions: `top` from the start of its content. */
export interface Span {
  top: number
  height: number
}

/**
 * Where the list's scroll rests so a row shows in full, moving it as little as that takes: `nearest`, as
 * scrollIntoView has it, for the list alone. scrollIntoView moves every box above the list that can scroll as well,
 * and the model list opens below its place and slides up, so it scrolled the lightbox itself and pushed the title and
 * the search off its top. `view` is what the list shows now: its scroll and its visible height. Pure, so it is tested.
 */
export function scrollToShow(row: Span, view: Span): number {
  if (row.top < view.top || row.height > view.height) return row.top
  const bottom = row.top + row.height
  return bottom > view.top + view.height ? bottom - view.height : view.top
}
