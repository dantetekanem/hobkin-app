import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DecidedChange } from '#shared/protocol/metrics.ts'
import { localDay } from '../src/features/numbers/format.ts'
import { sampleMetrics } from '../src/features/numbers/sample-metrics.ts'
import { chartOpens, decidedList, decidedWords, OPENING_CHARTS } from '../src/features/work/numbers-open.ts'
import { sampleDecided } from '../src/features/work/sample.ts'

const at = (day: number, hour: number) => new Date(2026, 10, day, hour).toISOString()
const TODAY = '2026-11-21'

const DECIDED: DecidedChange[] = [
  { slug: 'storefront', item: 'c1', title: 'Cache the category menu', at: at(21, 11), outcome: 'merged-by-itself', sentBack: 0, head: 'a1b2c3d' },
  { slug: 'billing-api', item: 'b9', title: 'Log each webhook delivery', at: at(21, 10), outcome: 'merged-by-you', sentBack: 0, head: '0b1c2d3' },
  { slug: 'storefront', item: 'c0', title: 'Fix the coupon field on mobile', at: at(20, 15), outcome: 'declined', sentBack: 1 },
  { slug: 'docs-site', item: 'd4', title: 'Document the export command', at: at(18, 9), outcome: 'merged-by-you', sentBack: 2, head: '77c1e9f' },
  { slug: 'storefront', item: 'c2', title: 'Keep the cart when a guest signs in', at: at(14, 16), outcome: 'merged-by-itself', sentBack: 0, head: 'a61f03d' },
]

test('what a chart opens: merged, first pass and the two waits list the changes behind them, AI reviews its tab, a project row its page, and proofs and tokens nothing', () => {
  assert.deepEqual(chartOpens({ chart: 'merged' }), { list: { chart: 'merged' } })
  assert.deepEqual(chartOpens({ chart: 'merged', from: '2026-11-20', to: '2026-11-20' }), { list: { chart: 'merged', from: '2026-11-20', to: '2026-11-20' } })
  assert.deepEqual(chartOpens({ chart: 'first-pass', from: '2026-11-15', to: '2026-11-21' }), { list: { chart: 'first-pass', from: '2026-11-15', to: '2026-11-21' } })
  assert.deepEqual(chartOpens({ chart: 'waiting' }), { list: { chart: 'waiting' } })
  assert.deepEqual(chartOpens({ chart: 'start-to-merge' }), { list: { chart: 'start-to-merge' } })
  assert.deepEqual(chartOpens({ chart: 'ai-reviews', from: '2026-11-21', to: '2026-11-21' }), { tab: 'reviews' })
  assert.deepEqual(chartOpens({ project: 'storefront' }), { project: 'storefront' })
  assert.equal(chartOpens({ chart: 'proofs' }), null)
  assert.equal(chartOpens({ chart: 'tokens', from: '2026-11-21', to: '2026-11-21' }), null)

  // The charts that open something are the ones that may look and act like buttons.
  assert.deepEqual([...OPENING_CHARTS].sort(), ['ai-reviews', 'first-pass', 'merged', 'projects', 'start-to-merge', 'waiting'])
})

test('the list behind a chart holds the changes it counts, on the day or run of days picked, newest first', () => {
  const merged = decidedList(DECIDED, { chart: 'merged' }, TODAY, 30)
  assert.deepEqual(merged.rows.map((change) => change.item), ['c1', 'b9', 'c0', 'd4', 'c2'])
  assert.equal(merged.heading, 'Merged and declined')
  assert.equal(merged.range, 'the last 30 days')

  const today = decidedList(DECIDED, { chart: 'merged', from: TODAY, to: TODAY }, TODAY, 30)
  assert.deepEqual(today.rows.map((change) => change.item), ['c1', 'b9'])
  assert.equal(today.range, 'Today')

  const week = decidedList(DECIDED, { chart: 'first-pass', from: '2026-11-15', to: TODAY }, TODAY, 30)
  assert.deepEqual(week.rows.map((change) => change.item), ['c1', 'b9', 'c0', 'd4'])
  assert.equal(week.range, 'Nov 15 to today')

  // Waiting for you measures the changes the user decided; start to merge, the ones that merged.
  assert.deepEqual(decidedList(DECIDED, { chart: 'waiting' }, TODAY, 30).rows.map((change) => change.item), ['b9', 'c0', 'd4'])
  assert.deepEqual(decidedList(DECIDED, { chart: 'start-to-merge' }, TODAY, 30).rows.map((change) => change.item), ['c1', 'b9', 'd4', 'c2'])

  assert.deepEqual(DECIDED.map(decidedWords), ['merged by itself · first pass', 'merged by you · first pass', 'declined · sent back once', 'merged by you · sent back 2 times', 'merged by itself · first pass'])
})

test('a host that lists no decided changes says so, rather than showing an empty list', () => {
  const list = decidedList(undefined, { chart: 'merged', from: TODAY, to: TODAY }, TODAY, 30)
  assert.equal(list.listed, false)
  assert.deepEqual(list.rows, [])
  assert.equal(decidedList([], { chart: 'merged' }, TODAY, 7).listed, true)
})

test("the sample lists one change for each the sample numbers count merged or declined, each day's first passes included", () => {
  const today = new Date(2026, 10, 21, 18)
  const metrics = sampleMetrics(30, today)
  const decided = sampleDecided(metrics, today.getTime())
  const sorted = [...decided].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  assert.deepEqual(decided, sorted, 'newest first')
  for (const project of metrics.projects) {
    for (const day of project.days) {
      const theirs = decided.filter((change) => change.slug === project.slug && localDay(Date.parse(change.at)) === day.day)
      assert.equal(theirs.length, day.mergedByItself + day.mergedByYou + day.declined, `${project.slug} ${day.day}`)
      assert.equal(theirs.filter((change) => change.outcome === 'merged-by-itself').length, day.mergedByItself)
      assert.equal(theirs.filter((change) => change.sentBack === 0).length, day.firstPass, `${project.slug} ${day.day} first pass`)
    }
  }
  assert.deepEqual(decidedList(decided, { chart: 'merged', from: '2026-11-21', to: '2026-11-21' }, '2026-11-21', 30).rows.length, 7 + metrics.all.days.at(-1)!.declined)
})
