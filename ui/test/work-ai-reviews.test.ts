import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AssessmentSummary } from '#shared/review/assessment.ts'
import type { ReviewListItem } from '#shared/review/status.ts'
import { canReviewAgain, canReviewNow, nothingChanged, repoWordsOf, reviewCounts, reviewToOpen, rowsOf, stateOf } from '../src/features/work/ai-reviews.ts'

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

const kinds = (reviews: ReviewListItem[]) => Object.fromEntries(rowsOf({ reviews }).map((row) => [row.item.id, row.state.kind]))

test('a review is reviewing only while its review runs or is being prepared; waiting its turn is its own state, and one that never ran is left out', () => {
  const reviews = [
    item('change:storefront:a1', { state: 'preparing', phase: 'reading', startedAt: at(1) }),
    item('change:storefront:a2', { assessment: { state: 'running', head: HEAD, percent: 33.3, now: 'Mapping the changed definitions', startedAt: at(2) } }),
    item('change:storefront:a3', { assessment: { state: 'queued', head: HEAD } }),
    item('change:storefront:a4', { state: 'preparing', phase: 'queued', startedAt: at(1) }),
    item('change:storefront:w1', { state: 'idle', waiting: true }),
    item('change:storefront:b1', { assessment: { state: 'ready', head: HEAD, summary: summary({ at: at(5) }) } }),
    item('pr:acme/web/12', { kind: 'pull', project: 'acme/web', updatedAt: at(6) }),
    item('change:storefront:c1', { state: 'failed', error: 'gh is not signed in', updatedAt: at(7) }),
    item('change:storefront:c2', { assessment: { state: 'failed', head: HEAD, error: 'The tests would not start.' }, updatedAt: at(8) }),
    item('pr:acme/web/13', { kind: 'pull', project: 'acme/web', state: 'idle' }),
    item('change:storefront:d1', { state: 'idle', assessment: { state: 'idle', head: HEAD } }),
  ]

  assert.deepEqual(kinds(reviews), {
    'change:storefront:a1': 'reviewing',
    'change:storefront:a2': 'reviewing',
    'change:storefront:a3': 'waits',
    'change:storefront:a4': 'waits',
    'change:storefront:w1': 'waits',
    'change:storefront:b1': 'ready',
    'pr:acme/web/12': 'ready',
    'change:storefront:c1': 'failed',
    'change:storefront:c2': 'failed',
  })
  assert.deepEqual(reviewCounts(rowsOf({ reviews })), { unmerged: 0, running: 2, waiting: 3, ready: 2, failed: 2 })
})

test('one cut short that starts again waits its turn, and says how many are ahead; a stopped one that waits for nothing stays out', () => {
  const rows = rowsOf({
    reviews: [
      item('change:storefront:w1', { state: 'idle', waiting: true, turn: { ahead: 3, why: 'Waits its turn: 3 ahead in storefront.' } }),
      item('change:storefront:w2', { state: 'idle', waiting: true, assessment: { state: 'failed', head: HEAD, error: 'An earlier review of this commit stopped before it finished.' } }),
      item('change:storefront:s1', { state: 'idle', assessment: { state: 'idle', head: HEAD } }),
    ],
  })

  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.item.id, [row.state, row.line, row.startedAt]])), {
    'change:storefront:w1': [{ kind: 'waits', ahead: 3 }, 'Waits its turn: 3 ahead in storefront.', null],
    'change:storefront:w2': [{ kind: 'waits', ahead: null }, 'Waits its turn', null],
  })
  assert.equal(stateOf(item('change:storefront:s1', { state: 'idle' })), null)
})

test('a reviewing row says how far along it is, what it is doing now, and when it started', () => {
  const rows = Object.fromEntries(
    rowsOf({
      reviews: [
        item('change:storefront:a1', { state: 'preparing', phase: 'reading', startedAt: at(1) }),
        item('change:storefront:a2', { state: 'preparing', phase: 'checking', startedAt: at(9), assessment: { state: 'running', head: HEAD, percent: 104.6, now: 'Running the checkout tests', startedAt: at(2) } }),
        item('change:storefront:a3', { state: 'preparing', startedAt: at(3) }),
      ],
    }).map((row) => [row.item.id, row]),
  )

  assert.deepEqual([rows['change:storefront:a1']!.line, rows['change:storefront:a1']!.percent, rows['change:storefront:a1']!.startedAt], ['Reading the change', null, Date.parse(at(1))])
  assert.deepEqual([rows['change:storefront:a2']!.line, rows['change:storefront:a2']!.percent, rows['change:storefront:a2']!.startedAt], ['Running the checkout tests', 100, Date.parse(at(2))], 'the change review is what it is doing, and its percent never passes 100')
  assert.equal(rows['change:storefront:a3']!.line, 'Starting')
})

test('a ready review asked for again says reviewing while it is built, with its start, and waits only while that waits its turn', () => {
  // The host keeps it ready, so the older review still opens, puts a change review queued behind the graph it draws,
  // and says how the build goes by its phase.
  const built = (id: string, over: Partial<ReviewListItem>) => item(id, { startedAt: at(1), assessment: { state: 'queued', head: HEAD }, ...over })
  const rows = Object.fromEntries(
    rowsOf({
      reviews: [
        built('pr:acme/web/20', { kind: 'pull', project: 'acme/web', phase: 'reading' }),
        built('change:storefront:r1', { phase: 'checking', assessment: { state: 'ready', head: HEAD, summary: summary({ at: at(30) }) } }),
        built('change:storefront:r2', { phase: 'arranging', assessment: undefined }),
        built('change:storefront:r3', { phase: 'queued', assessment: undefined }),
      ],
    }).map((row) => [row.item.id, [row.state, row.line, row.startedAt]]),
  )

  assert.deepEqual(rows, {
    'pr:acme/web/20': [{ kind: 'reviewing', percent: null }, 'Reading the change', Date.parse(at(1))],
    'change:storefront:r1': [{ kind: 'reviewing', percent: null }, 'Checking the result', Date.parse(at(1))],
    'change:storefront:r2': [{ kind: 'reviewing', percent: null }, 'Arranging the story', Date.parse(at(1))],
    'change:storefront:r3': [{ kind: 'waits', ahead: null }, 'Waits its turn', null],
  })
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
  assert.deepEqual(rowsOf(null), [])
})

test('a review that is ready or stopped can be run again, and one under way or waiting cannot be started twice', () => {
  const rows = rowsOf({
    reviews: [
      item('change:storefront:a2', { assessment: { state: 'running', head: HEAD, percent: 10, startedAt: at(1) } }),
      item('change:storefront:a3', { assessment: { state: 'queued', head: HEAD } }),
      item('change:storefront:b1', { assessment: { state: 'ready', head: HEAD, summary: summary({ at: at(5) }) } }),
      item('change:storefront:c1', { state: 'failed', error: 'gh is not signed in', updatedAt: at(7) }),
    ],
  })
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.item.id, canReviewAgain(row)])), {
    'change:storefront:a2': false,
    'change:storefront:a3': false,
    'change:storefront:b1': true,
    'change:storefront:c1': true,
  })
})

test('a merge that failed has a row with why, and is counted as not merged; one that waits has no row', () => {
  const rows = rowsOf({
    reviews: [
      item('change:storefront:b1', { assessment: { state: 'ready', head: HEAD, summary: summary({ at: at(5) }) } }),
      item('change:storefront:m1', { assessment: { state: 'ready', head: HEAD, summary: summary({ at: at(9) }) }, mergeAsked: { at: at(2), state: 'failed', why: 'It moved since it was offered, so nothing merged.' } }),
      item('change:storefront:m2', { assessment: { state: 'ready', head: HEAD, summary: summary({ at: at(9) }) }, mergeAsked: { at: at(1), state: 'waiting' } }),
      item('pr:corp:acme/shop/7', { kind: 'pull', mergeAsked: { at: at(1), state: 'waiting', message: 'The merge queue lands it once its checks pass.' } }),
    ],
  })
  assert.deepEqual(rows.map((row) => [row.item.id, row.merge?.why ?? null]).sort(), [['change:storefront:b1', null], ['change:storefront:m1', 'It moved since it was offered, so nothing merged.']])
  assert.deepEqual(reviewCounts(rows), { unmerged: 1, running: 0, waiting: 0, ready: 1, failed: 0 })
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

const OLDER = 'e1d2c3b'.padEnd(40, '0')
/** A repository's rows as a host that keeps a line of reviews sends them, with the line above them. */
const lineList = () => ({
  repos: [
    { project: 'shop', current: 3, waiting: 12, outdated: 2, builtThisWeek: 9, tokensThisWeek: 1_100_000 },
    { project: 'storefront', current: 1, waiting: 0, outdated: 0, builtThisWeek: 2 },
  ],
  reviews: [
    item('change:shop:w3', { project: 'shop', state: 'idle', waiting: true, turn: { ahead: 3, why: 'Waits its turn: 3 ahead in shop.' }, updatedAt: at(1) }),
    item('change:shop:w1', { project: 'shop', state: 'idle', waiting: true, turn: { ahead: 1, why: 'Waits its turn: 1 ahead in shop.' }, updatedAt: at(2) }),
    item('change:shop:old', { project: 'shop', outdated: { builtFor: OLDER }, turn: { ahead: 4, why: 'Waits its turn: 4 ahead in shop.' }, assessment: { state: 'ready', head: OLDER } }),
    item('change:shop:carried', { project: 'shop', carried: { from: OLDER, why: 'Only its start moved, and its tests passed at this commit.' }, assessment: { state: 'ready', head: HEAD } }),
    item('change:storefront:now', { assessment: { state: 'running', head: HEAD, percent: 10, startedAt: at(3) } }),
  ],
})

test("each repository's line counts its current, waiting and outdated reviews and what they cost this week", () => {
  assert.deepEqual([...repoWordsOf(lineList())], [
    ['shop', '3 current · 12 waiting · 2 outdated · 9 built this week, about 1.1M tokens'],
    ['storefront', '1 current · 0 waiting · 0 outdated · 2 built this week'],
  ])
  // A host from before the line sends none, and the list has no line.
  assert.deepEqual([...repoWordsOf({ reviews: lineList().reviews })], [])
  assert.deepEqual([...repoWordsOf(null)], [])
})

test('a row that waits says why and how many are ahead, and stays in the list, not folded under its repository', () => {
  const rows = Object.fromEntries(rowsOf(lineList()).map((row) => [row.item.id, row]))

  assert.deepEqual([rows['change:shop:w1']!.state, rows['change:shop:w1']!.turn?.why], [{ kind: 'waits', ahead: 1 }, 'Waits its turn: 1 ahead in shop.'])
  assert.deepEqual(rows['change:shop:w3']!.state, { kind: 'waits', ahead: 3 })
  assert.ok(canReviewNow(rows['change:shop:w1']!), 'it offers Review now')
  assert.equal(rows['change:storefront:now']!.state.kind, 'reviewing')
  assert.equal(rows['change:shop:old']!.state.kind, 'ready', 'an outdated review opens, and says it is outdated')
})

test('an outdated row says for which commit it was built, and a carried one from which commit it was carried and why it holds', () => {
  const rows = Object.fromEntries(rowsOf(lineList()).map((row) => [row.item.id, row]))

  assert.equal(rows['change:shop:old']!.standing, 'Outdated: built for e1d2c3b. Waits its turn: 4 ahead in shop.')
  assert.equal(rows['change:shop:carried']!.standing, 'Carried from e1d2c3b, not built again. Only its start moved, and its tests passed at this commit.')
  assert.equal(rows['change:storefront:now']!.standing, null)
  // Nothing changed since the carried review, so Review again asks first. The outdated one is built at once.
  assert.equal(nothingChanged(rows['change:shop:carried']!), true)
  assert.equal(nothingChanged(rows['change:shop:old']!), false)
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
    'pr:acme/web/12': 'Cover 8 · Proof 4 · Deploy 7 · Watch not known · Undo 9 · rate –',
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
