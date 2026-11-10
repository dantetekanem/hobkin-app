import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rowsOf, walk, type Box } from '../src/features/integrations/walk.ts'

const box = (left: number, top: number, width = 100, height = 60): Box => ({ left, top, width, height })

// Three columns, then a shorter row of two, then another part with smaller tiles, then one wide row (a list item).
const GRID: Box[] = [
  box(0, 0),
  box(110, 0),
  box(220, 0),
  box(0, 70),
  box(110, 70),
  box(0, 160, 160, 40),
  box(170, 160, 160, 40),
  box(0, 220, 330, 50),
]

test('tiles fall into rows, top to bottom and each left to right', () => {
  assert.deepEqual(rowsOf(GRID), [[0, 1, 2], [3, 4], [5, 6], [7]])
  assert.deepEqual(rowsOf([box(110, 2), box(0, 0)]), [[1, 0]], 'a tile a little lower is still in the same row')
  assert.deepEqual(rowsOf([]), [])
})

test('left and right move along the reading order, across the ends of rows', () => {
  assert.equal(walk(GRID, 0, 'ArrowRight'), 1)
  assert.equal(walk(GRID, 2, 'ArrowRight'), 3, 'from the end of a row to the start of the next')
  assert.equal(walk(GRID, 3, 'ArrowLeft'), 2, 'and back')
  assert.equal(walk(GRID, 0, 'ArrowLeft'), 0, 'the first stays the first')
  assert.equal(walk(GRID, 7, 'ArrowRight'), 7, 'the last stays the last')
})

test('down goes to the row below, to the tile nearest by its center', () => {
  assert.equal(walk(GRID, 0, 'ArrowDown'), 3)
  assert.equal(walk(GRID, 1, 'ArrowDown'), 4)
  assert.equal(walk(GRID, 2, 'ArrowDown'), 4, 'nothing right under it, so the nearest')
  assert.equal(walk(GRID, 4, 'ArrowDown'), 5, 'into the next part, whose tiles are another size')
  assert.equal(walk(GRID, 6, 'ArrowDown'), 7)
  assert.equal(walk(GRID, 7, 'ArrowDown'), 7, 'the last row stays')
})

test('up goes to the row above, and a tie goes to the tile on the left', () => {
  assert.equal(walk(GRID, 3, 'ArrowUp'), 0)
  assert.equal(walk(GRID, 7, 'ArrowUp'), 5, 'both tiles above are as near, so the left one')
  assert.equal(walk(GRID, 0, 'ArrowUp'), 0, 'the first row stays')
})

test('the order comes from where tiles sit, not from the order they are given in', () => {
  const given = [GRID[4]!, GRID[0]!, GRID[2]!, GRID[1]!, GRID[3]!]
  assert.equal(walk(given, 1, 'ArrowRight'), 3, 'from the first tile to the one beside it')
  assert.equal(walk(given, 1, 'ArrowDown'), 4)
})

test('with nothing to start from, a key lands on the first tile, and with no tiles there is nowhere to go', () => {
  assert.equal(walk(GRID, -1, 'ArrowDown'), 0)
  assert.equal(walk(GRID, -1, 'ArrowLeft'), 0)
  assert.equal(walk([], -1, 'ArrowDown'), -1)
})
