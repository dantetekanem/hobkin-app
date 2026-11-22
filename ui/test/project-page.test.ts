import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DecidedChange, WorkMetrics } from '#shared/protocol/metrics.ts'
import type { ModelFact, WorkState, YoloState } from '#shared/protocol/work.ts'
import { sumDays } from '../src/features/numbers/format.ts'
import { sampleMetrics } from '../src/features/numbers/sample-metrics.ts'
import { atWorkOf, keepSections, projectPage, reviewsOf, type AgentLike, type ProjectInput, type TakenPage } from '../src/features/project/model.ts'
import { SAMPLE_YOLO } from '../src/features/settings/yolo.ts'
import { sampleWork } from '../src/features/work/sample.ts'
import { SAMPLE_REVIEW_LIST } from '../src/features/work/sample-reviews.ts'

const TODAY = new Date(2026, 10, 21, 15, 30)
const NOW = TODAY.getTime()

const MODELS: ModelFact[] = [{ spec: '_specs/tla/Checkout.tla', state: 'holds', run: 'run-1', line: 'TLC: 4 of 4 hold in 48,211 states · at 9b04d2a' }]

const AGENTS: AgentLike[] = [
  { id: 'a1', title: 'Fix the login redirect loop', project: 'storefront', doing: 'running the auth tests', kind: 'work', hue: 262 },
  { id: 'a2', title: 'Look for dependency updates', project: 'billing-api', doing: 'reading the changelog', kind: 'work', hue: 200 },
  { id: 'a3', title: 'Morning recap', project: 'routine', doing: 'writing the report', kind: 'routine', hue: 86 },
  { id: 'a4', title: 'Tighten the checkout tests', project: 'storefront', doing: 'reading the test file', kind: 'work', hue: 20, asks: 'Keep the old fixtures?' },
  { id: 'hobkin:h1', title: 'A hobkin of the user', project: 'storefront', doing: 'waiting', kind: 'session', hue: 10 },
]

const at = (day: number, hour: number) => new Date(2026, 10, day, hour).toISOString()

const DECIDED: DecidedChange[] = [
  { slug: 'storefront', item: 'c1', title: 'Cache the category menu', at: at(21, 11), outcome: 'merged-by-itself', sentBack: 0, head: 'a1b2c3d' },
  { slug: 'billing-api', item: 'b9', title: 'Log each webhook delivery', at: at(21, 10), outcome: 'merged-by-you', sentBack: 0, head: '0b1c2d3' },
  { slug: 'storefront', item: 'c0', title: 'Fix the coupon field on mobile', at: at(20, 15), outcome: 'declined', sentBack: 1 },
  { slug: 'storefront', item: '8d2f60', title: 'Fix the login redirect after a password reset', at: at(14, 9), outcome: 'merged-by-you', sentBack: 2, head: '2e6b0c4' },
]

/** The sample's work, with the models it is given on the default branch. */
function work(change: (state: WorkState) => WorkState = (state) => state): WorkState {
  const state = sampleWork(NOW)
  return change({ ...state, projects: state.projects.map((project) => (project.slug === 'storefront' ? { ...project, models: MODELS } : project)) })
}

/** The sample's YOLO mode, with one merge by itself on storefront. */
const YOLO: YoloState = {
  ...SAMPLE_YOLO,
  projects: SAMPLE_YOLO.projects.map((project) =>
    project.slug === 'storefront' ? { ...project, merged: [{ at: at(21, 11), item: 'c1', title: 'Cache the category menu', kind: 'performance work', rate: 9, head: 'a1b2c3d', deploy: 'It deployed and held.', held: true }] } : project,
  ),
}

/** The sample's 30 days with `decided`, or as a host older than that list sends them when it is null. */
const metrics = (decided: DecidedChange[] | null = DECIDED): WorkMetrics => ({ ...sampleMetrics(30, TODAY), ...(decided ? { decided } : {}) })

function input(change: Partial<ProjectInput> = {}): ProjectInput {
  return {
    slug: 'storefront',
    work: work(),
    yolo: YOLO,
    metrics: metrics(),
    metricsState: 'ready',
    reviews: reviewsOf(SAMPLE_REVIEW_LIST, change.slug ?? 'storefront'),
    agents: AGENTS,
    live: true,
    ...change,
  }
}

function taken(change: Partial<ProjectInput> = {}): TakenPage {
  const page = projectPage(input(change))
  assert.equal(page.kind, 'taken')
  return page as TakenPage
}

test("a busy project's page reads its heading, tiles and flow from what Work, YOLO mode and the numbers know", () => {
  const page = taken()
  assert.deepEqual(
    { name: page.heading.name, priority: page.heading.priority, pr: page.heading.prWords, level: page.heading.level, paused: page.heading.paused, repo: page.heading.repo },
    { name: 'storefront', priority: 'P0', pr: 'Draft PRs', level: 'critical', paused: false, repo: 'hobkin-sample/storefront' },
  )
  assert.deepEqual({ label: page.heading.yolo?.label, tone: page.heading.yolo?.tone }, { label: 'YOLO ready', tone: 'ok' })

  const days = metrics().projects.find(({ slug }) => slug === 'storefront')!.days
  const month = sumDays(days.slice(-30))
  assert.deepEqual(
    page.tiles.tiles.map(({ key }) => key),
    ['waiting', 'merged', 'first-pass', 'by-itself', 'ai-reviews', 'tokens'],
  )
  const [waiting, merged, , , reviews, tokens] = page.tiles.tiles
  assert.equal(waiting!.figure, '4')
  assert.equal(waiting!.context, '2 need you · 2 ready')
  assert.equal(merged!.label, 'Merged (30 d)')
  assert.equal(merged!.figure, String(month.mergedByItself + month.mergedByYou))
  // Of the sample's reviews of storefront's changes: one runs, two are ready.
  assert.equal(`${reviews!.figure} ${reviews!.after}`, '1 running')
  assert.equal(reviews!.context, '2 ready · 0 failed')
  // The tokens of the project's own day, with no allowance beside them: the day's allowance is all projects'.
  assert.equal(tokens!.figure, '24M')
  assert.equal(tokens!.after, undefined)
  assert.equal(page.tiles.loading, false)

  assert.deepEqual(page.flow, { queued: 1, working: 2, waiting: 4, merged: month.mergedByItself + month.mergedByYou })
})

test('the sections list what waits, what works and what is queued here, each row with what it opens', () => {
  const page = taken()
  // What needs the user first, then what is left for them, then what is ready to merge.
  assert.deepEqual(
    page.waiting.rows.map(({ key }) => key),
    ['storefront:d2c4e8', 'storefront:f41c07', 'storefront:4c9e21', 'storefront:8d2f60'],
  )
  const [cart, left, shipping] = page.waiting.rows
  assert.deepEqual(
    { title: cart!.title, why: cart!.why, needsYou: cart!.needsYou, size: cart!.size, review: cart!.review, answer: cart!.answer?.state },
    { title: 'Move the cart into one module', why: 'It conflicts with the default branch.', needsYou: true, size: '410 lines · 9 files', review: 'change:storefront:d2c4e8', answer: 'ready' },
  )
  // No AI review of it is known, so it shows none.
  assert.equal(left!.answer, null)
  assert.equal(shipping!.answer?.state, 'running')
  assert.equal(shipping!.needsYou, false)

  // Its own work agents, the one waiting for the user first. Other projects', routines and the user's hobkins are not here.
  assert.deepEqual(
    page.atWork.rows.map(({ id, asks }) => [id, asks]),
    [
      ['a4', 'Keep the old fixtures?'],
      ['a1', null],
    ],
  )
  assert.deepEqual(atWorkOf(AGENTS, 'billing-api').map(({ id }) => id), ['a2'])

  assert.equal(page.queue.opens, true)
  assert.deepEqual(
    page.queue.rows.map(({ key, grade, words, cost, skipped, picked }) => ({ key, grade, words, cost, skipped, picked })),
    [
      { key: 'item:storefront:7a31c2', grade: 'P0', words: 'urgent, critical, high impact, small', cost: '~180k', skipped: false, picked: true },
      { key: 'item:storefront:91f0aa', grade: 'P3', words: 'skipped', cost: '~150k', skipped: true, picked: false },
    ],
  )
})

test('merged lately lists its changes merged or declined, newest first, saying who merged each, and models and readiness are its own', () => {
  const page = taken()
  assert.equal(page.merged.kind, 'list')
  if (page.merged.kind !== 'list') return
  assert.deepEqual(
    page.merged.rows.map(({ item, when, words, sentBack, head, rate }) => ({ item, when, words, sentBack, head, rate })),
    [
      { item: 'c1', when: 'Today', words: 'by itself', sentBack: null, head: 'a1b2c3d', rate: 9 },
      { item: 'c0', when: 'Yesterday', words: 'declined', sentBack: 'sent back once', head: null, rate: null },
      { item: '8d2f60', when: 'Sat, Nov 14', words: 'by you', sentBack: 'sent back 2 times', head: '2e6b0c4', rate: null },
    ],
  )
  assert.equal(page.merged.more, 0)
  assert.equal(page.merged.count, '2 merged · 1 declined')
  // A row opens the review the window knows of it, and only that: opening an unknown one would prepare a new review.
  assert.deepEqual(
    page.merged.rows.map(({ review }) => review),
    [null, null, 'change:storefront:8d2f60'],
  )
  // Without a host, every row opens the sample's review, as a finished card does.
  const sample = taken({ live: false })
  assert.ok(sample.merged.kind === 'list' && sample.merged.rows.every(({ review }) => review === 'sample'))

  assert.deepEqual(page.models.facts, MODELS)
  assert.equal(page.readiness.known, true)
  if (!page.readiness.known) return
  assert.equal(page.readiness.state, 'Ready')
  assert.deepEqual(
    page.readiness.groups.map(({ heading, rows }) => [heading, rows.map(({ name }) => name)]),
    [['Improvements', ['errors', 'alerts', 'deploy']]],
  )
  assert.match(page.readiness.inPlace ?? '', /^In place: Tests, Slow queries/)
})

test('a project with nothing yet keeps every section and says in each that it has nothing', () => {
  const nothing = work((state) => ({ ...state, projects: state.projects.map((project) => (project.slug === 'design-kit' ? { ...project, state: 'chosen' } : project)) }))
  const page = taken({ slug: 'design-kit', work: nothing })
  assert.deepEqual(page.flow, { queued: 0, working: 0, waiting: 0, merged: 0 })
  assert.deepEqual(
    page.tiles.tiles.map(({ figure, context }) => [figure, context]),
    [
      ['0', 'none waiting'],
      ['0', 'nothing in 30 days'],
      ['no data yet', 'nothing decided yet'],
      ['no data yet', 'nothing merged yet'],
      ['0', '0 ready · 0 failed'],
      ['0', 'resets at midnight'],
    ],
  )
  for (const section of [page.waiting, page.atWork, page.queue]) {
    assert.deepEqual(section.rows, [])
    assert.ok(section.empty.length > 0)
  }
  assert.ok(page.merged.kind === 'list' && page.merged.rows.length === 0 && page.merged.count === '0 merged' && page.merged.empty === 'Nothing merged or declined here in 30 days.')
  assert.deepEqual(page.models.facts, [])
  assert.equal(page.models.empty, 'No TLA+ models on its default branch.')
  assert.equal(page.readiness.known, false)
  assert.equal(page.heading.yolo, null)
})

test('a project work mode has not taken shows its heading, says so, and offers to take it', () => {
  const proposed = projectPage(input({ slug: 'design-kit' }))
  assert.deepEqual(proposed, { kind: 'not-taken', name: 'design-kit', state: 'Proposed', line: 'Work mode has not taken this project, so nothing runs here. Take it to queue work on it.' })
  const skipped = projectPage(input({ slug: 'old-landing' }))
  assert.equal(skipped.kind === 'not-taken' && skipped.state, 'Skipped')

  assert.deepEqual(projectPage(input({ slug: 'nowhere' })), { kind: 'unknown', name: 'nowhere', line: 'Work mode knows no project called nowhere.' })
  assert.deepEqual(projectPage(input({ work: null })), { kind: 'unknown', name: 'storefront', line: 'This host has not said anything about work mode yet.' })
})

test('with a host that sends no list of decided changes, its merges by day stand in, and with no numbers at all each part says so', () => {
  const older = taken({ metrics: metrics(null) })
  assert.equal(older.merged.kind, 'days')
  if (older.merged.kind !== 'days') return
  const days = metrics().projects.find(({ slug }) => slug === 'storefront')!.days.slice(-30)
  assert.equal(older.merged.days.length, 30)
  assert.deepEqual(
    older.merged.series.map(({ key, values }) => [key, values]),
    [
      ['itself', days.map((day) => day.mergedByItself)],
      ['you', days.map((day) => day.mergedByYou)],
    ],
  )
  assert.deepEqual(older.merged.line.values, days.map((day) => day.declined))
  assert.equal(older.merged.note, 'The list of each merge needs a newer host. These are its merges by day.')

  const none = taken({ metrics: null, metricsState: 'older-host' })
  assert.deepEqual(none.merged, { kind: 'none', note: 'This host sends no numbers yet.' })
  assert.equal(none.flow.merged, null)
  assert.ok(none.tiles.tiles.slice(1, 4).every(({ figure }) => figure === 'no data yet'))
  assert.equal(none.tiles.note, 'This host sends no numbers yet.')
  // Waiting for you is Work's own count, which needs no numbers.
  assert.equal(none.tiles.tiles[0]!.figure, '4')

  const reading = taken({ metrics: null, metricsState: 'loading' })
  assert.equal(reading.tiles.loading, true)
  assert.deepEqual(reading.merged, { kind: 'none', note: 'Reading the numbers…' })
})

test('a section that says the same as the page drawn before keeps its object, so it is not drawn again', () => {
  const drawn = projectPage(input())
  const again = projectPage(input())
  assert.equal(keepSections(drawn, again), drawn)

  // A review that moves on changes the waiting rows and the tiles, and nothing else.
  const list = { reviews: SAMPLE_REVIEW_LIST.reviews.map((review) => (review.id === 'change:storefront:4c9e21' ? { ...review, assessment: { ...review.assessment!, percent: 80 } } : review)) }
  const moved = keepSections(drawn, projectPage(input({ reviews: reviewsOf(list, 'storefront') }))) as TakenPage
  const before = drawn as TakenPage
  assert.notEqual(moved.waiting, before.waiting)
  for (const key of ['heading', 'tiles', 'flow', 'atWork', 'queue', 'merged', 'models', 'readiness'] as const) assert.equal(moved[key], before[key], key)
})

test("a paused project's heading says so and its queue rows wait on the pause instead of opening Work", () => {
  const paused = work((state) => ({ ...state, projects: state.projects.map((project) => (project.slug === 'storefront' ? { ...project, paused: true } : project)) }))
  const page = taken({ work: paused })
  assert.equal(page.heading.paused, true)
  assert.equal(page.queue.opens, false)
  assert.equal(page.queue.rows.length, 2)
  assert.equal(page.queue.note, 'Paused: nothing here starts until you resume it.')
})
