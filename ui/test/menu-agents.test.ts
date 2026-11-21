import assert from 'node:assert/strict'
import { test } from 'node:test'
import { estimatedRow, putBack, rowPieces, type RowGeometry, type RowPiece } from '../src/app/menu-agents.ts'

/** How wide the pieces lay out, the row's gaps included: as wide as the whole row when every bare button keeps its item's place. */
function laidOut(pieces: RowPiece[], geometry: RowGeometry, open: number): number {
  const widthOf = (piece: RowPiece) => (piece.kind === 'agent' && piece.index === open ? geometry.open : geometry.item)
  const gaps = (pieces.length - 1) * geometry.gap
  return pieces.reduce((sum, piece) => sum + widthOf(piece), 0) + gaps
}

const whole = (pieces: RowPiece[]) => pieces.flatMap((piece) => (piece.kind === 'agent' ? [piece.index] : []))

test("the menu's agents row draws the items on screen whole, keeps every other agent a bare button in its place, and draws the one with the keyboard whole", () => {
  const width = 1400
  const geometry = { ...estimatedRow(100, width), open: 150 }
  for (const open of [50, 0, -1]) {
    const pieces = rowPieces(100, open, geometry)

    // Every agent has its piece, in order, so Tab and a screen reader reach each one.
    assert.deepEqual(
      pieces.map((piece) => piece.index),
      Array.from({ length: 100 }, (_, index) => index),
    )
    const row = 100 * geometry.item + 99 * geometry.gap + (open >= 0 ? geometry.open - geometry.item : 0)
    assert.equal(laidOut(pieces, geometry, open), row)
    if (open >= 0) assert.ok(whole(pieces).includes(open))

    // Every item on screen is drawn whole, and far fewer than a hundred are.
    for (let index = 0; index < 100; index++) {
      const start = geometry.left + index * (geometry.item + geometry.gap) + (open >= 0 && index > open ? geometry.open - geometry.item : 0)
      if (start + geometry.item > 0 && start < width) assert.ok(whole(pieces).includes(index), `item ${index} is on screen`)
    }
    assert.ok(whole(pieces).length < 45, `${whole(pieces).length} items drawn whole`)
  }

  // An agent off screen that the keyboard reached is drawn whole where it is.
  const reached = rowPieces(100, 50, geometry, 3)
  assert.deepEqual(reached[3], { kind: 'agent', index: 3 })
  assert.deepEqual(rowPieces(100, 50, geometry)[3], { kind: 'bare', index: 3 })

  // A row that fits draws every item whole.
  assert.deepEqual(
    rowPieces(5, 2, estimatedRow(5, width)),
    [0, 1, 2, 3, 4].map((index) => ({ kind: 'agent', index })),
  )
})

test('a focus that scrolled the window or a box that hides its overflow to show an agent past the edge is put back', () => {
  // Tab onto an agent past the window's right edge: the browser scrolls what it can to show it.
  const window = { scrollLeft: 340, scrollTop: 0 }
  const hidden = { scrollLeft: 12, scrollTop: 30 }
  // A list the user scrolls keeps its place.
  const list = { scrollLeft: 50, scrollTop: 80 }

  putBack([
    { box: hidden, overflowX: 'hidden', overflowY: 'hidden', viewport: false },
    { box: list, overflowX: 'auto', overflowY: 'auto', viewport: false },
    { box: window, overflowX: 'visible', overflowY: 'visible', viewport: true },
  ])

  assert.deepEqual(window, { scrollLeft: 0, scrollTop: 0 })
  assert.deepEqual(hidden, { scrollLeft: 0, scrollTop: 0 })
  assert.deepEqual(list, { scrollLeft: 50, scrollTop: 80 })
})
