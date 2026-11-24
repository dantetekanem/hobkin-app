import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AssessmentSummary } from '#shared/review/assessment.ts'
import type { ReviewListItem } from '#shared/review/status.ts'
import { canReviewAgain, groupReviews, reviewCounts, reviewToOpen, rowsOf } from '../src/features/work/ai-reviews.ts'

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
  assert.deepEqual(reviewCounts(groups), { unmerged: 0, running: 3, ready: 2, failed: 2 })
})

test('a finished change whose review has not started shows as waiting its turn, after those under way; a stopped one that waits for nothing stays out', () => {
  const groups = groupReviews({
    reviews: [
      item('change:storefront:w1', { state: 'idle', waiting: true, updatedAt: at(1) }),
      item('change:storefront:w2', { state: 'idle', waiting: true, assessment: { state: 'failed', head: HEAD, error: 'An earlier review of this commit stopped before it finished.' } }),
      item('change:storefront:a2', { assessment: { state: 'running', head: HEAD, percent: 10, startedAt: at(2) } }),
      item('change:storefront:s1', { state: 'idle', assessment: { state: 'idle', head: HEAD } }),
    ],
  })

  assert.deepEqual(groups.running.map((row) => [row.item.id, row.line, row.startedAt]), [
    ['change:storefront:a2', 'Starting', Date.parse(at(2))],
    ['change:storefront:w2', 'Waiting its turn', null],
    ['change:storefront:w1', 'Waiting its turn', null],
  ])
  assert.deepEqual(groups.failed, [], 'one cut short that starts again is waiting, not failed')
  assert.ok(![...groups.running, ...groups.ready].some((row) => row.item.id === 'change:storefront:s1'))
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

test('a row opens its own review; without a host a finished change opens the sample review, as its Work card does', () => {
  const change = item('change:billing-api:5e7c21', {})
  const pull = item('pr:hobkin-sample/storefront/482', { kind: 'pull' })
  assert.equal(reviewToOpen(change, true), 'change:billing-api:5e7c21')
  assert.equal(reviewToOpen(pull, true), 'pr:hobkin-sample/storefront/482')
  assert.equal(reviewToOpen(change, false), 'sample')
  assert.equal(reviewToOpen(pull, false), 'pr:hobkin-sample/storefront/482')
  assert.deepEqual(groupReviews(null), { unmerged: [], running: [], ready: [], failed: [] })
})

test('a review that is ready or stopped can be run again, and one under way cannot be started twice', () => {
  const rows = rowsOf({
    reviews: [
      item('change:storefront:a2', { assessment: { state: 'running', head: HEAD, percent: 10, startedAt: at(1) } }),
      item('change:storefront:b1', { assessment: { state: 'ready', head: HEAD, summary: summary({ at: at(5) }) } }),
      item('change:storefront:c1', { state: 'failed', error: 'gh is not signed in', updatedAt: at(7) }),
    ],
  })
  assert.deepEqual(rows.map((row) => [row.group, canReviewAgain(row)]), [['running', false], ['ready', true], ['failed', true]])
})

test('a merge the user asked for that has not happened comes first in the list, with why, until it merges', () => {
  const groups = groupReviews({
    reviews: [
      item('change:storefront:b1', { assessment: { state: 'ready', head: HEAD, summary: summary({ at: at(5) }) } }),
      item('change:storefront:m1', { assessment: { state: 'ready', head: HEAD, summary: summary({ at: at(9) }) }, mergeAsked: { at: at(2), state: 'failed', why: 'It moved since it was offered, so nothing merged.' } }),
      item('change:storefront:m2', { assessment: { state: 'ready', head: HEAD, summary: summary({ at: at(9) }) }, mergeAsked: { at: at(1), state: 'waiting' } }),
    ],
  })
  assert.deepEqual(groups.unmerged.map((row) => [row.item.id, row.line]), [
    ['change:storefront:m2', 'You said merge. hobkin is bringing it up to date, and merges it after that.'],
    ['change:storefront:m1', 'You said merge, and it did not merge: It moved since it was offered, so nothing merged.'],
  ])
  assert.deepEqual(groups.ready.map((row) => row.item.id), ['change:storefront:b1'], 'it is listed once, where it will be looked for')
  assert.equal(reviewCounts(groups).unmerged, 2)
})

test("a merge a code host does in its own time shows that host's own sentence on its row", () => {
  const groups = groupReviews({ reviews: [item('pr:corp:acme/shop/7', { kind: 'pull', mergeAsked: { at: at(1), state: 'waiting', message: 'The merge queue lands it once its checks pass.' } })] })
  assert.deepEqual(groups.unmerged.map((row) => row.line), ['You said merge. The merge queue lands it once its checks pass.'])
})

test('a row names its pull request by number and links to its page: its own, or the one a finished change opened', () => {
  const rows = rowsOf({
    reviews: [
      item('change:storefront:b1', { pr: 'https://github.com/Acme/Web/pull/12' }),
      item('change:storefront:b2', {}),
      item('change:storefront:b3', { pr: 'https://elsewhere.invalid/acme/web/pull/9' }),
      item('pr:acme/web/13', { kind: 'pull', project: 'acme/web' }),
    ],
  })

  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.item.id, [row.where, row.link]])), {
    'change:storefront:b1': ['storefront #12', 'https://github.com/acme/web/pull/12'],
    'change:storefront:b2': ['storefront', null],
    // An address that is no pull request page here is never a link.
    'change:storefront:b3': ['storefront', null],
    'pr:acme/web/13': ['acme/web #13', 'https://github.com/acme/web/pull/13'],
  })
})

test('each group follows the order the user picked: by priority with the longest wait first among equals, newest first, or oldest first', () => {
  const ready = (id: string, minutesAgo: number, over: Partial<ReviewListItem> = {}) =>
    item(id, { assessment: { state: 'ready', head: HEAD, summary: summary({ at: at(minutesAgo) }) }, updatedAt: at(minutesAgo), ...over })
  const list = {
    reviews: [
      ready('change:storefront:casual', 1),
      ready('change:storefront:urgent-new', 2),
      ready('pr:acme/web/12', 3, { kind: 'pull', project: 'acme/web' }),
      ready('change:storefront:urgent-old', 9),
    ],
  }
  const priorities: Record<string, 'P0' | 'P2'> = {
    'change:storefront:casual': 'P2',
    'change:storefront:urgent-new': 'P0',
    'change:storefront:urgent-old': 'P0',
  }
  const priorityOf = (review: ReviewListItem) => priorities[review.id] ?? null
  const readyIn = (order: 'priority' | 'newest' | 'oldest') => groupReviews(list, { order, priorityOf }).ready.map((row) => row.item.id)

  assert.deepEqual(readyIn('priority'), ['change:storefront:urgent-old', 'change:storefront:urgent-new', 'change:storefront:casual', 'pr:acme/web/12'])
  assert.deepEqual(readyIn('newest'), ['change:storefront:casual', 'change:storefront:urgent-new', 'pr:acme/web/12', 'change:storefront:urgent-old'])
  assert.deepEqual(readyIn('oldest'), ['change:storefront:urgent-old', 'pr:acme/web/12', 'change:storefront:urgent-new', 'change:storefront:casual'])

  const unordered = groupReviews(list, { priorityOf }).ready

  assert.deepEqual(unordered.map((row) => row.item.id), readyIn('newest'), 'with no order picked, newest first')
  assert.deepEqual(unordered.map((row) => row.priority), ['P2', 'P0', null, 'P0'], 'a row says the priority of its work')
})

test('in any order, reviews under way come before those that wait their turn', () => {
  const list = {
    reviews: [
      item('change:storefront:waits', { assessment: { state: 'queued', head: HEAD } }),
      item('change:storefront:runs', { assessment: { state: 'running', head: HEAD, percent: 10, startedAt: at(4) } }),
    ],
  }
  const priorityOf = (review: ReviewListItem) => (review.id === 'change:storefront:waits' ? 'P0' : 'P3')

  for (const order of ['priority', 'newest', 'oldest'] as const) {
    const running = groupReviews(list, { order, priorityOf }).running.map((row) => row.item.id)

    assert.deepEqual(running, ['change:storefront:runs', 'change:storefront:waits'], `in the order ${order}`)
  }
})

test("a row carries the review's five ratings and its rate, a pull request's too, and nothing when it is not rated", () => {
  const scores = { coverage: { score: 8, evidence: 'Covered.' }, proof: { score: 4, evidence: 'Capped at 4: no test added.' }, safety: { score: 7, evidence: 'No data.' }, rollback: { score: 9, evidence: 'A revert.' } }
  const rows = rowsOf({
    reviews: [
      item('change:storefront:a1', { needs: [{ kind: 'bug-fix', scores: { ...scores, visibility: { score: 6, evidence: 'Errors are reported.' } }, rate: 7.4, head: HEAD, by: 'change-review' }] }),
      item('pr:acme/web/12', { kind: 'pull', project: 'acme/web', needs: [{ scores, head: HEAD, by: 'change-review' }] }),
      item('change:storefront:a2', { rate: 8.4 }),
    ],
  })
  const shown = Object.fromEntries(rows.map((row) => [row.item.id, row.needs && `${row.needs.numbers.map(({ word, value }) => `${word} ${value}`).join(' · ')} · rate ${row.needs.rate ?? '–'}`]))

  assert.deepEqual(shown, {
    'change:storefront:a1': 'Cover 8 · Proof 4 · Deploy 7 · Watch 6 · Undo 9 · rate 7.4',
    'pr:acme/web/12': 'Cover 8 · Proof 4 · Deploy 7 · Watch – · Undo 9 · rate –',
    'change:storefront:a2': null,
  })
})

test("a scored change's row carries its general rate, and a row with none carries none", () => {
  const rows = rowsOf({
    reviews: [
      item('change:storefront:a1', { rate: 8.4 }),
      item('change:storefront:a2', {}),
      item('pr:acme/web/12', { kind: 'pull', project: 'acme/web' }),
    ],
  })
  const rates = Object.fromEntries(rows.map((row) => [row.item.id, row.rate]))
  assert.deepEqual(rates, { 'change:storefront:a1': 8.4, 'change:storefront:a2': null, 'pr:acme/web/12': null })
})
