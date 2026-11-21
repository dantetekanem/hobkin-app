/**
 * Which items of the screen menu's agents row are drawn whole. The row is as wide as its agents and centered, so with
 * many agents it runs past the window's edges. An item past them is a bare button as wide as the item, with no face:
 * it keeps every other item where it was, and Tab and a screen reader still reach its agent. The open agent's item,
 * and one the keyboard reached, are always drawn whole. Pure, so the rule is tested without a window.
 */

/** Where the row lies on screen, in the window's pixels, as the menu measured it. */
export interface RowGeometry {
  /** The row's left edge. */
  left: number
  /** The window's width. */
  width: number
  /** An item's width, the open agent's (it carries its name), and the gap between two items. */
  item: number
  open: number
  gap: number
}

/** An agent's item drawn whole, or a bare button in its place. */
export interface RowPiece {
  kind: 'agent' | 'bare'
  index: number
}

/** An item's width and the row's gap before the menu measures them: 8 px of padding each side of a 20 px face, and gap-0.5. */
const ITEM = 36
const GAP = 2
/** How many items past each edge of the window are still drawn, so a row that glides a little shows no hole. */
const PAST_EDGE = 2

/** The row centered in the window, before the menu has measured where it lies. */
export function estimatedRow(count: number, width: number): RowGeometry {
  return { left: (width - (count * (ITEM + GAP) - GAP)) / 2, width, item: ITEM, open: ITEM, gap: GAP }
}

/** The row's pieces, one for each agent in order. `keyboard` is the place of an agent the keyboard reached. */
export function rowPieces(count: number, open: number, geometry: RowGeometry, keyboard: number | null = null): RowPiece[] {
  const pitch = geometry.item + geometry.gap
  const margin = PAST_EDGE * pitch
  // The items after the open one sit further right by as much as its name makes it wider.
  const widening = geometry.open - geometry.item

  return Array.from({ length: count }, (_, index) => {
    const start = geometry.left + index * pitch + (open >= 0 && index > open ? widening : 0)
    const onScreen = start + geometry.item > -margin && start < geometry.width + margin
    const whole = onScreen || index === open || index === keyboard
    return { kind: whole ? 'agent' : 'bare', index }
  })
}
