import assert from 'node:assert/strict'
import { test } from 'node:test'
import { estimatedRow, rowPieces, type RowGeometry, type RowPiece } from '../src/app/menu-agents.ts'

/** How wide the pieces lay out, gaps between them included: as wide as the whole row when every gap keeps its items' places. */
const laidOut = (pieces: RowPiece[], geometry: RowGeometry, open: number) =>
  pieces.reduce((sum, piece) => sum + (piece.kind === 'gap' ? piece.width : piece.index === open ? geometry.open : geometry.item), 0) + (pieces.length - 1) * geometry.gap

test("the menu's agents row draws the items on screen and the open one, and its gaps keep every other item in place", () => {
  const width = 1400
  const geometry = { ...estimatedRow(100, width), open: 150 }
  for (const open of [50, 0, -1]) {
    const pieces = rowPieces(100, open, geometry)
    const drawn = pieces.flatMap((piece) => (piece.kind === 'agent' ? [piece.index] : []))
    const whole = 100 * geometry.item + 99 * geometry.gap + (open >= 0 ? geometry.open - geometry.item : 0)
    assert.equal(laidOut(pieces, geometry, open), whole)
    if (open >= 0) assert.ok(drawn.includes(open))
    // Every item that is on screen is drawn, and far fewer than a hundred are.
    for (let index = 0; index < 100; index++) {
      const start = geometry.left + index * (geometry.item + geometry.gap) + (open >= 0 && index > open ? geometry.open - geometry.item : 0)
      if (start + geometry.item > 0 && start < width) assert.ok(drawn.includes(index), `item ${index} is on screen`)
    }
    assert.ok(drawn.length < 45, `${drawn.length} items drawn`)
  }
  // A row that fits draws every item, with no gap.
  assert.deepEqual(rowPieces(5, 2, estimatedRow(5, width)), [0, 1, 2, 3, 4].map((index) => ({ kind: 'agent', index })))
})
