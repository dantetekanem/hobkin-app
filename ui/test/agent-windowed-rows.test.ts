import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withDrawnTurns } from '../src/features/hobkins/conversation.ts'
import { FreshKeys, endFrom, mountedIndexes, nearRows, nextWalkable, piecesOf, rowsAt, type Span } from '../src/features/agent-activity/windowed-rows.ts'

/** Rows of these heights, 12 px apart, the first 8 px down: where each one sits in the list. */
function laidOut(heights: readonly number[], { first = 8, gap = 12 } = {}): (index: number) => Span {
  const spans: Span[] = []
  let at = first
  for (const height of heights) {
    spans.push({ start: at, end: at + height })
    at += height + gap
  }
  return (index) => spans[index]!
}

const rows = (count: number, height = 100) => Array.from({ length: count }, () => height)

/** The rows drawn for `count` rows laid out by `spanOf`: by default no view, no margin, nothing kept and not following. */
const drawnOf = (input: Pick<Parameters<typeof mountedIndexes>[0], 'count' | 'spanOf'> & Partial<Parameters<typeof mountedIndexes>[0]>) =>
  mountedIndexes({ visible: null, margin: 0, most: 0, keep: [], endFrom: null, ...input })

test('the rows in view are drawn with a margin of rows around them, never more than a few each way', () => {
  const visible = { startIndex: 50, endIndex: 55 }

  const drawn = drawnOf({ count: 100, spanOf: laidOut(rows(100)), visible, margin: 250, most: 8 })
  const capped = drawnOf({ count: 100, spanOf: laidOut(rows(100, 4)), visible, margin: 10_000, most: 5 })

  // 250 px of 112 px rows: three each way, then the newest.
  assert.deepEqual(drawn, [47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 99])
  // Rows 16 px apart fill the margin long before it ends: five each way.
  assert.deepEqual(capped, [45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 99])
})

test('the newest row, the focused row and the rows the user opened stay drawn wherever the view is', () => {
  const drawn = drawnOf({ count: 100, spanOf: laidOut(rows(100)), visible: { startIndex: 10, endIndex: 12 }, keep: [70, 3, 11, 70] })

  assert.deepEqual(drawn, [3, 10, 11, 12, 70, 99])
})

test('rows that are not in the list are never asked for', () => {
  const spanOf = laidOut(rows(5))

  const all = drawnOf({ count: 5, spanOf, visible: { startIndex: 0, endIndex: 4 }, margin: 1000, most: 10, keep: [9, -1] })
  const none = drawnOf({ count: 0, spanOf })

  assert.deepEqual(all, [0, 1, 2, 3, 4])
  assert.deepEqual(none, [])
})

test('while the list follows its newest row, the rows its end shows are drawn even before the view has moved there', () => {
  const heights = [...rows(50), 300, 40, 40]
  const spanOf = laidOut(heights)
  // A 500 px view at the end shows the last three rows and the one above them.
  const from = endFrom(heights.length, spanOf, 500)
  const drawn = drawnOf({ count: heights.length, spanOf, visible: { startIndex: 0, endIndex: 4 }, endFrom: from })

  assert.equal(from, 49)
  assert.deepEqual(drawn, [0, 1, 2, 3, 4, 49, 50, 51, 52])
  assert.equal(endFrom(3, laidOut([10, 10, 10]), 500), 0)
})

test('the rows not drawn are spacers as tall as they are, so the drawn ones stand where they would', () => {
  const spanOf = laidOut([100, 50, 200, 80, 60, 90])
  const pieces = piecesOf([2, 3, 5], 6, spanOf, 12)
  // Above row 2: rows 0 and 1 with the gap between them (100 + 12 + 50); the list's own gap stands before row 2.
  assert.deepEqual(pieces, [
    { kind: 'gap', key: 'gap:0', height: 162 },
    { kind: 'row', index: 2 },
    { kind: 'row', index: 3 },
    { kind: 'gap', key: 'gap:1', height: 60 },
    { kind: 'row', index: 5 },
  ])
  assert.deepEqual(piecesOf([0, 1, 2], 6, spanOf, 12).at(-1), { kind: 'gap', key: 'gap:0', height: 80 + 12 + 60 + 12 + 90 })
  assert.deepEqual(piecesOf([0, 1], 2, laidOut([10, 10]), 12), [
    { kind: 'row', index: 0 },
    { kind: 'row', index: 1 },
  ])
})

test('a row arrives only the first time its key is in the list, not when it scrolls back into view', () => {
  const fresh = new FreshKeys()
  // Drawn with the list: simply there.
  assert.equal(fresh.fresh('a'), false)
  fresh.drawn(['a', 'b'])
  assert.equal(fresh.fresh('a'), false)
  // A new step arrives.
  assert.equal(fresh.fresh('c'), true)
  fresh.drawn(['a', 'b', 'c'])
  // Drawn again after scrolling out of view and back: it is not new.
  assert.equal(fresh.fresh('c'), false)
  // A step that came while it was out of view is not new either once it is scrolled to.
  fresh.drawn(['a', 'b', 'c', 'd'])
  assert.equal(fresh.fresh('d'), false)
  // A row that went and came back, as the thinking row between steps, arrives again.
  fresh.drawn(['a', 'b', 'c', 'd'])
  fresh.drawn(['a', 'b', 'c'])
  assert.equal(fresh.fresh('d'), true)
})

test('the keyboard walks onto the next row it can stand on, past rows it cannot, and stops at the ends', () => {
  const walkable = (index: number) => index !== 3 && index !== 9
  assert.equal(nextWalkable(2, 1, 10, walkable), 4)
  assert.equal(nextWalkable(4, -1, 10, walkable), 2)
  assert.equal(nextWalkable(8, 1, 10, walkable), -1)
  assert.equal(nextWalkable(0, -1, 10, walkable), -1)
  // From past either end: the first and the last it can stand on.
  assert.equal(nextWalkable(-1, 1, 10, walkable), 0)
  assert.equal(nextWalkable(10, -1, 10, walkable), 8)
})

test('rows near the view: in it, or within a few rows of it', () => {
  const view = { startIndex: 40, endIndex: 48 }
  assert.equal(nearRows(view, 44, 44, 5), true)
  assert.equal(nearRows(view, 36, 36, 5), true)
  assert.equal(nearRows(view, 30, 34, 5), false)
  assert.equal(nearRows(view, 30, 39, 0), false)
  assert.equal(nearRows(view, 30, 40, 0), true)
  assert.equal(nearRows(view, 53, 60, 5), true)
  assert.equal(nearRows(view, 54, 60, 5), false)
  assert.equal(nearRows(null, 0, 0, 5), false)
})

test('the turns whose rows are drawn are the ones read, in the order they come into view', () => {
  const page = [
    { key: 't1:asked', run: 't1' },
    { key: 't1:answer', run: 't1' },
    { key: 't2:asked', run: 't2' },
    { key: 't2:answer', run: 't2' },
    { key: 't3:asked', run: 't3' },
    { key: 'working' },
  ]
  const atEnd = rowsAt(piecesOf([4, 5], page.length, laidOut(rows(page.length)), 12), page)
  assert.deepEqual(atEnd, [page[4], page[5]])
  const held = withDrawnTurns([], atEnd)
  assert.deepEqual(held, ['t3'])
  // Scrolling up brings the first turn in: it is read too, and the ones read before stay.
  const up = rowsAt(piecesOf([0, 1, 5], page.length, laidOut(rows(page.length)), 12), page)
  assert.deepEqual(withDrawnTurns(held, up), ['t3', 't1'])
})
