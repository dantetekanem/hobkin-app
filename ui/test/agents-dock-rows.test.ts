import assert from 'node:assert/strict'
import { test } from 'node:test'
import { centeredOn, MOST_ROWS, ROW, rowsInView, rowTop, stepped, viewHeight, type DockShape } from '../src/app/dock-rows.ts'

/** The dock's list as the user walks it: what Up and Down select, where the list scrolls, and which rows it mounts. */
function walk(shape: DockShape) {
  const count = shape.durable + shape.others
  const visits: number[] = []
  const look = (at: number) => {
    const top = centeredOn(shape, at)
    const rows = rowsInView(shape, top, at)
    assert.ok(rows.length <= MOST_ROWS, `${rows.length} rows mounted at ${at}`)
    assert.ok(rows.includes(at), `the selected row ${at} is mounted`)
    // The selected row is wholly in view, and every row whose middle is in view is mounted.
    assert.ok(rowTop(shape, at) >= top && rowTop(shape, at) + shape.row <= top + viewHeight(shape), `row ${at} is in view`)
    for (let index = 0; index < count; index++) {
      const middle = rowTop(shape, index) + shape.row / 2
      if (middle > top && middle < top + viewHeight(shape)) assert.ok(rows.includes(index), `row ${index} in view at ${at} is mounted`)
    }
    visits.push(at)
  }
  // Down from an empty message enters the list on its first agent.
  let at = 0
  look(at)
  for (let next = stepped(at, 'ArrowDown', count); next !== at; next = stepped(at, 'ArrowDown', count)) look((at = next as number))
  for (let next = stepped(at, 'ArrowUp', count); next !== 'input'; next = stepped(at, 'ArrowUp', count)) look((at = next))
  return visits
}

test('100 agents mount six rows and the keys walk all of them', () => {
  for (const shape of [
    { durable: 0, others: 100, row: ROW },
    { durable: 12, others: 88, row: ROW },
  ]) {
    const all = Array.from({ length: 100 }, (_, index) => index)
    assert.deepEqual(walk(shape), [...all, ...all.toReversed().slice(1)])
    // Scrolled away from the selected agent, the list still mounts it, and still six rows in all.
    const end = centeredOn(shape, 99)
    const rows = rowsInView(shape, end, 0)
    assert.equal(rows.length, MOST_ROWS)
    assert.equal(rows[0], 0)
    assert.ok(rows.includes(99))
  }
  // A short list mounts every row.
  assert.deepEqual(rowsInView({ durable: 1, others: 2, row: ROW }, 0, null), [0, 1, 2])
})
