import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Grade, QueueRow } from '#shared/protocol/work.ts'
import { outsidePaused, queueInSight, startNowLine } from '../src/features/work/queue-rows.ts'

const row = (key: string, grade: Grade, skipped = false, slug = 'storefront'): QueueRow => ({
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

test('a long queue shows its first five rows in hobkin order, every P0 among them, and says how many it holds back', () => {
  const queue = [row('a', 'P1'), row('b', 'P1'), row('c', 'P2'), row('d', 'P2'), row('e', 'P3'), row('urgent', 'P0'), row('f', 'P3'), row('g', 'P3'), row('skipped', 'P2', true)]
  const shut = queueInSight(queue, false)
  assert.deepEqual(keys(shut.rows), ['a', 'b', 'c', 'd', 'urgent'], 'the P0 keeps its place in sight, and the rest fill what is left')
  assert.equal(shut.hidden, 4)

  const open = queueInSight(queue, true)
  assert.deepEqual(keys(open.rows), ['a', 'b', 'c', 'd', 'e', 'urgent', 'f', 'g', 'skipped'], 'all of it, skipped rows last')
  assert.equal(open.hidden, 0)
})

test('a short queue shows all of it, and more P0 than fit still all show', () => {
  const short = [row('a', 'P1'), row('skipped', 'P2', true), row('b', 'P2')]
  assert.deepEqual(keys(queueInSight(short, false).rows), ['a', 'b', 'skipped'])
  assert.equal(queueInSight(short, false).hidden, 0)

  const urgent = ['1', '2', '3', '4', '5', '6'].map((key) => row(key, 'P0'))
  assert.deepEqual(keys(queueInSight([...urgent, row('later', 'P2')], false).rows), ['1', '2', '3', '4', '5', '6'])
})

test("Start now says what hobkin said, and a refusal names the row it was for and keeps hobkin's reason", () => {
  const started = 'Queued Tighten the checkout tests to start at once. It starts now as one extra worker.'
  assert.deepEqual(startNowLine('Tighten the checkout tests', { tone: 'done', text: started }), { tone: 'done', text: started })
  assert.deepEqual(startNowLine('Tighten the checkout tests', { tone: 'done', text: '' }), { tone: 'done', text: 'Tighten the checkout tests: asked to start at once.' })
  assert.deepEqual(startNowLine('Tighten the checkout tests', { tone: 'refused', text: 'Work mode is off, so it waits for hobkin work start.' }), {
    tone: 'refused',
    text: 'Tighten the checkout tests did not start: Work mode is off, so it waits for hobkin work start.',
  })
})

test('a paused project takes all its rows out of the queue, and the queue says how many it holds for paused projects', () => {
  const queue = [row('a', 'P0', false, 'client'), row('b', 'P1'), row('c', 'P2', false, 'client'), row('d', 'P2', true, 'client'), row('discover', 'P3', false, '')]
  const { rows, paused } = outsidePaused(queue, new Set(['client']))
  assert.deepEqual(keys(rows), ['b', 'discover'], 'every row of the paused project goes, skipped ones too, and a row of no project stays')
  assert.equal(paused, 3)

  const none = outsidePaused(queue, new Set())
  assert.equal(none.rows, queue, 'with nothing paused the queue is the same list')
  assert.equal(none.paused, 0)
})
