import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Grade, QueueRow } from '#shared/protocol/work.ts'
import { opensQueue, queueCount, queueSignature, sheetRows, shownBefore } from '../src/features/work/queue-sheet.ts'

const row = (key: string, slug = 'storefront', skipped = false, grade: Grade = 'P2'): QueueRow => ({
  key,
  kind: 'item',
  slug,
  project: slug,
  item: key,
  title: `Item ${key}`,
  grade,
  why: null,
  waiting: null,
  skipped,
  picked: false,
  tokens: null,
})
const keys = (rows: readonly QueueRow[]) => rows.map(({ key }) => key)

test('the sheet lists every row in hobkin order with skipped rows last, and the rows of paused projects after them', () => {
  const queue = [row('a'), row('p1', 'api'), row('s', 'storefront', true), row('b'), row('p2', 'api'), row('ps', 'api', true)]
  const { rows, paused } = sheetRows(queue, new Set(['api']), null)
  assert.deepEqual(keys(rows), ['a', 'b', 's'])
  assert.deepEqual(keys(paused), ['p1', 'p2', 'ps'])
})

test('a project choice keeps its rows only, and all projects shows the rest', () => {
  const queue = [row('a'), row('x', 'web'), row('b'), row('y', 'web')]
  assert.deepEqual(keys(sheetRows(queue, new Set(), 'web').rows), ['x', 'y'])
  assert.deepEqual(keys(sheetRows(queue, new Set(), null).rows), ['a', 'x', 'b', 'y'])
})

test('the count is every waiting row hobkin has, paused projects included, and what the status cut short', () => {
  const shown = [row('a'), row('b'), row('s', 'storefront', true)]
  assert.equal(queueCount({ queue: shown, queued: 64 }), 65, '64 waiting and one skipped')
  assert.equal(queueCount({ queue: shown, queued: 1 }), 3, 'never fewer than the rows listed')
  assert.equal(queueCount({ queue: [], queued: 0 }), 0)
})

test('the control shows only when the queue lists fewer rows than it holds', () => {
  assert.equal(shownBefore(5, 65), true)
  assert.equal(shownBefore(5, 5), false)
  assert.equal(shownBefore(0, 0), false)
})

test('the signature changes with the rows, their order and their skips, and not with a re-read of the same queue', () => {
  const one = [row('a'), row('b')]
  assert.equal(queueSignature(one, 2), queueSignature([row('a'), row('b')], 2))
  assert.notEqual(queueSignature(one, 2), queueSignature([row('b'), row('a')], 2))
  assert.notEqual(queueSignature(one, 2), queueSignature([row('a'), row('b', 'storefront', true)], 2))
  assert.notEqual(queueSignature(one, 2), queueSignature(one, 60))
})

test('Q opens the queue once, with no modifier, while nothing is typed in or used it', () => {
  const press = { key: 'q', metaKey: false, ctrlKey: false, altKey: false, repeat: false, handled: false, typing: false }
  assert.equal(opensQueue(press), true)
  assert.equal(opensQueue({ ...press, key: 'Q' }), true)
  assert.equal(opensQueue({ ...press, metaKey: true }), false, '⌘Q quits the app')
  assert.equal(opensQueue({ ...press, repeat: true }), false)
  assert.equal(opensQueue({ ...press, typing: true }), false)
  assert.equal(opensQueue({ ...press, key: 'w' }), false)
})
