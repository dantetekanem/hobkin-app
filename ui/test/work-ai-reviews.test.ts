import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AssessmentSummary } from '#shared/review/assessment.ts'
import type { ReviewListItem } from '#shared/review/status.ts'
import { groupReviews, levelCountsOf, reviewCounts, reviewToOpen, rowsOf } from '../src/features/work/ai-reviews.ts'

const HEAD = 'f3a9c1e7'.padEnd(40, '0')
const at = (minutesAgo: number) => new Date(Date.parse('2026-11-12T12:00:00Z') - minutesAgo * 60_000).toISOString()
const summary = (over: Partial<AssessmentSummary>): AssessmentSummary => ({ level: 'safe', critical: false, needsYou: 0, worthALook: 0, safe: 1, storyBy: 'model', at: at(0), ...over })

const item = (id: string, over: Partial<ReviewListItem>): ReviewListItem => ({
  id,
  kind: 'change',
  title: id,
  project: 'storefront',
  head: HEAD,
  state: 'ready',
  phase: null,
  error: null,
  updatedAt: at(0),
  ...over,
})

test('reviews fall into running, ready and failed, and one that never ran is left out', () => {
  const groups = groupReviews({
    reviews: [
      item('change:storefront:a1', { state: 'preparing', phase: 'reading', startedAt: at(1) }),
      item('change:storefront:a2', { assessment: { state: 'running', head: HEAD, percent: 33.3, now: 'Mapping the changed definitions', startedAt: at(2) } }),
      item('change:storefront:a3', { assessment: { state: 'queued', head: HEAD } }),
      item('change:storefront:b1', { assessment: { state: 'ready', head: HEAD, summary: summary({ at: at(5) }) } }),
      item('pr:acme/web/12', { kind: 'pull', project: 'acme/web', updatedAt: at(6) }),
      item('change:storefront:c1', { state: 'failed', error: 'gh is not signed in', updatedAt: at(7) }),
      item('change:storefront:c2', { assessment: { state: 'failed', head: HEAD, error: 'The tests would not start.' }, updatedAt: at(8) }),
      item('pr:acme/web/13', { kind: 'pull', project: 'acme/web', state: 'idle' }),
      item('change:storefront:d1', { state: 'idle', assessment: { state: 'idle', head: HEAD } }),
    ],
  })

  assert.deepEqual(groups.running.map((row) => row.item.id), ['change:storefront:a1', 'change:storefront:a2', 'change:storefront:a3'])
  assert.deepEqual(groups.ready.map((row) => row.item.id), ['change:storefront:b1', 'pr:acme/web/12'])
  assert.deepEqual(
    groups.failed.map((row) => [row.item.id, row.line]),
    [
      ['change:storefront:c1', 'gh is not signed in'],
      ['change:storefront:c2', 'The tests would not start.'],
    ],
  )
  assert.deepEqual(reviewCounts(groups), { running: 3, ready: 2, failed: 2 })
})

test('a running review says how far along it is, what it is doing now, and when it started; one still waiting comes after those under way', () => {
  const [graph, change, queued] = groupReviews({
    reviews: [
      item('change:storefront:a1', { state: 'preparing', phase: 'reading', startedAt: at(1) }),
      item('change:storefront:a2', { state: 'preparing', phase: 'checking', startedAt: at(9), assessment: { state: 'running', head: HEAD, percent: 104.6, now: 'Running the checkout tests', startedAt: at(2) } }),
      item('change:storefront:a3', { assessment: { state: 'queued', head: HEAD }, updatedAt: at(3) }),
    ],
  }).running

  assert.deepEqual([graph!.line, graph!.percent, graph!.startedAt], ['Reading the change', null, Date.parse(at(1))])
  assert.deepEqual([change!.line, change!.percent, change!.startedAt], ['Running the checkout tests', 100, Date.parse(at(2))], 'the change review is what it is doing, and its percent never passes 100')
  assert.deepEqual([queued!.line, queued!.percent, queued!.startedAt], ['Waiting its turn', null, null])
})

test('each group is newest first by its own time: running by when it started, ready by when it finished, whatever order the host sent', () => {
  const groups = groupReviews({
    reviews: [
      item('change:storefront:old-finish', { updatedAt: at(1), assessment: { state: 'ready', head: HEAD, summary: summary({ at: at(60) }) } }),
      item('pr:acme/web/7', { kind: 'pull', project: 'acme/web', updatedAt: at(30), assessment: { state: 'ready', head: HEAD, summary: summary({ at: at(30) }) } }),
      item('change:storefront:new-finish', { updatedAt: at(40), assessment: { state: 'ready', head: HEAD, summary: summary({ at: at(2) }) } }),
      item('change:storefront:early-start', { assessment: { state: 'running', head: HEAD, percent: 80, startedAt: at(20) } }),
      item('pr:acme/web/8', { kind: 'pull', project: 'acme/web', assessment: { state: 'running', head: HEAD, percent: 5, startedAt: at(1) } }),
    ],
  })

  assert.deepEqual(groups.ready.map((row) => row.item.id), ['change:storefront:new-finish', 'pr:acme/web/7', 'change:storefront:old-finish'])
  assert.deepEqual(groups.ready.map((row) => row.at), [Date.parse(at(2)), Date.parse(at(30)), Date.parse(at(60))])
  assert.deepEqual(groups.running.map((row) => row.item.id), ['pr:acme/web/8', 'change:storefront:early-start'])
  assert.deepEqual(
    rowsOf({ reviews: [item('change:storefront:x', { updatedAt: at(10), assessment: { state: 'ready', head: HEAD, summary: summary({ at: at(10) }) } }), item('pr:acme/web/9', { kind: 'pull', project: 'acme/web', assessment: { state: 'running', head: HEAD, startedAt: at(4) } })] }).map((row) => row.item.id),
    ['pr:acme/web/9', 'change:storefront:x'],
    'all rows together are newest first too',
  )
})

test('a pull request is named by its repository and number, and a finished change by its project', () => {
  const [pull, change] = rowsOf({
    reviews: [item('pr:acme/web/12', { kind: 'pull', project: 'Acme/Web', updatedAt: at(1) }), item('change:billing-api:5e7c21', { project: 'billing-api', updatedAt: at(2) })],
  })
  assert.equal(pull!.where, 'Acme/Web #12')
  assert.equal(change!.where, 'billing-api')
})

test('a finished review counts its units at each level, high first, and leaves out a level with none', () => {
  assert.deepEqual(levelCountsOf(summary({ level: 'high', needsYou: 2, worthALook: 0, safe: 4 })), [
    { level: 'high', count: 2 },
    { level: 'safe', count: 4 },
  ])
  assert.deepEqual(levelCountsOf(summary({ level: 'mid', needsYou: 0, worthALook: 3, safe: 0 })), [{ level: 'mid', count: 3 }])
})

test('a row opens its own review; without a host a finished change opens the sample review, as its Work card does', () => {
  const change = item('change:billing-api:5e7c21', {})
  const pull = item('pr:hobkin-sample/storefront/482', { kind: 'pull' })
  assert.equal(reviewToOpen(change, true), 'change:billing-api:5e7c21')
  assert.equal(reviewToOpen(pull, true), 'pr:hobkin-sample/storefront/482')
  assert.equal(reviewToOpen(change, false), 'sample')
  assert.equal(reviewToOpen(pull, false), 'pr:hobkin-sample/storefront/482')
  assert.deepEqual(groupReviews(null), { running: [], ready: [], failed: [] })
})
