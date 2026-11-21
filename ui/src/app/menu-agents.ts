/**
 * Which items of the screen menu's agents row are drawn. The row is as wide as its agents and centered, so with many
 * agents it runs past the window's edges. Items past them are not drawn: a gap as wide as they were keeps every other
 * item where it was. The open agent's item is always drawn. Pure, so the rule is tested without a window.
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

export type RowPiece = { kind: 'agent'; index: number } | { kind: 'gap'; from: number; width: number }

/** An item's width and the row's gap before the menu measures them: 8 px of padding each side of a 20 px face, and gap-0.5. */
const ITEM = 36
const GAP = 2
/** How many items past each edge of the window are still drawn, so a row that glides a little shows no hole. */
const PAST_EDGE = 2

/** The row centered in the window, before the menu has measured where it lies. */
export function estimatedRow(count: number, width: number): RowGeometry {
  return { left: (width - (count * (ITEM + GAP) - GAP)) / 2, width, item: ITEM, open: ITEM, gap: GAP }
}

/** The row's pieces in order: each item drawn, and a gap for each run of items that are not. */
export function rowPieces(count: number, open: number, geometry: RowGeometry): RowPiece[] {
  const pitch = geometry.item + geometry.gap
  const margin = PAST_EDGE * pitch
  // The items after the open one sit further right by as much as its name makes it wider.
  const widening = geometry.open - geometry.item
  const pieces: RowPiece[] = []

  for (let index = 0; index < count; index++) {
    const start = geometry.left + index * pitch + (open >= 0 && index > open ? widening : 0)
    const onScreen = start + geometry.item > -margin && start < geometry.width + margin
    if (index === open || onScreen) {
      pieces.push({ kind: 'agent', index })
      continue
    }

    const last = pieces.at(-1)
    if (last?.kind === 'gap') last.width += pitch
    else pieces.push({ kind: 'gap', from: index, width: geometry.item })
  }
  return pieces
}
