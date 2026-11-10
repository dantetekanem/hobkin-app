/**
 * Moving the keyboard across tiles, by where they sit on screen rather than where they come in the page.
 * Left and Right go back and forth in reading order, across the ends of rows. Up and Down go to the row
 * above or below, to the tile nearest the one that had the keyboard. Boxes go in, an index comes out:
 * nothing here touches the page, so it can be tested alone. See _specs/019-keyboard.
 */

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

export function isArrowKey(key: string): key is ArrowKey {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight'
}

/** Indexes into `boxes`, as rows from top to bottom, each from left to right. A box joins a row when it starts above the middle of the row's first box. */
export function rowsOf(boxes: readonly Box[]): number[][] {
  const byTop = boxes.map((_, index) => index).sort((a, b) => boxes[a]!.top - boxes[b]!.top || boxes[a]!.left - boxes[b]!.left)
  const rows: number[][] = []
  for (const index of byTop) {
    const row = rows.at(-1)
    const first = row ? boxes[row[0]!]! : null
    if (row && first && boxes[index]!.top < first.top + first.height / 2) row.push(index)
    else rows.push([index])
  }
  return rows.map((row) => row.sort((a, b) => boxes[a]!.left - boxes[b]!.left))
}

/** Where the keyboard goes from box `from` for an arrow key. With nothing to start from it lands on the first box. With no boxes it is -1. */
export function walk(boxes: readonly Box[], from: number, key: ArrowKey): number {
  const rows = rowsOf(boxes)
  const reading = rows.flat()
  if (reading.length === 0) return -1
  const at = reading.indexOf(from)
  if (at === -1) return reading[0]!
  if (key === 'ArrowLeft') return reading[Math.max(0, at - 1)]!
  if (key === 'ArrowRight') return reading[Math.min(reading.length - 1, at + 1)]!

  const row = rows.findIndex((members) => members.includes(from))
  const target = rows[row + (key === 'ArrowDown' ? 1 : -1)]
  if (!target) return from
  const center = (index: number) => boxes[index]!.left + boxes[index]!.width / 2
  const distance = (index: number) => Math.abs(center(index) - center(from))
  // The nearest by its center. A tie keeps the one on the left, which comes first in the row.
  return target.reduce((best, index) => (distance(index) < distance(best) ? index : best))
}
