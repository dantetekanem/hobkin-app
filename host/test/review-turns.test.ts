import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lineOf, type LineChange } from '../src/review/turns.ts'

const NOW = Date.parse('2026-11-23T12:00:00.000Z')
const HOUR = 60 * 60 * 1000
const finished = (count: number, more: (index: number) => Partial<LineChange> = () => ({})): LineChange[] =>
  Array.from({ length: count }, (_, index) => ({ id: `change:shop:c${index + 1}`, repo: 'shop', name: 'Shop', at: new Date(NOW - HOUR).toISOString(), ...more(index) }))

test("of twenty finished changes of one project only the first three in Work's order are built; the rest wait, each with how many are ahead", () => {
  const line = lineOf(finished(20), { now: NOW })

  assert.deepEqual([...line.current], ['change:shop:c1', 'change:shop:c2', 'change:shop:c3'])
  assert.deepEqual(line.waits.get('change:shop:c4'), { ahead: 3, why: 'Waits its turn: 3 ahead in Shop.' })
  assert.deepEqual(line.waits.get('change:shop:c20'), { ahead: 19, why: 'Waits its turn: 19 ahead in Shop.' })
  assert.equal(line.waits.size, 17)
})

test('P0 work is always taken, and each repository has its own line', () => {
  const changes = [...finished(5, (index) => (index === 4 ? { grade: 'P0' } : {})), { id: 'change:blog:b1', repo: 'blog', name: 'Blog' }]

  const line = lineOf(changes, { now: NOW, keep: 2 })

  assert.deepEqual([...line.current].sort(), ['change:blog:b1', 'change:shop:c1', 'change:shop:c5'])
  assert.equal(line.waits.get('change:shop:c2')?.ahead, 2)
})

test('a change that conflicts, is being brought up to date or is back at work is not built, and says why', () => {
  const line = lineOf(finished(5, (index) => [{ conflict: true }, { refreshing: true }, { atWork: true }][index] ?? {}), { now: NOW })

  assert.deepEqual([...line.current], ['change:shop:c4', 'change:shop:c5'])
  assert.deepEqual(line.waits.get('change:shop:c1'), { ahead: 0, why: 'It conflicts with its base, so its review waits for the rebase.' })
  assert.deepEqual(line.waits.get('change:shop:c2'), { ahead: 0, why: 'It is being brought up to date to merge, so it is not reviewed again now.' })
  assert.deepEqual(line.waits.get('change:shop:c3'), { ahead: 0, why: 'An agent is working on it again, so its review waits until it finishes.' })
})

test('a change that waited two days is taken next', () => {
  const changes = finished(6, (index) => (index === 5 ? { at: new Date(NOW - 49 * HOUR).toISOString() } : {}))

  const line = lineOf(changes, { now: NOW })

  assert.deepEqual([...line.current], ['change:shop:c6', 'change:shop:c1', 'change:shop:c2'])
  assert.equal(line.waits.get('change:shop:c3')?.ahead, 3)
})

test('the number kept current is the workload’s when it is a whole number, else three', () => {
  assert.equal(lineOf(finished(6), { now: NOW, keep: 5 }).current.size, 5)
  for (const keep of [0, -1, 2.5, Number.NaN]) assert.equal(lineOf(finished(6), { now: NOW, keep }).current.size, 3, String(keep))
})
