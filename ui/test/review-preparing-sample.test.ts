import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChangeAssessment } from '../../shared/review/assessment.ts'
import type { Review, ReviewSource } from '../../shared/review/types.ts'
import { createReviewLoader } from '../src/features/review/loader.ts'
import { preparingOf, underWay } from '../src/features/review/preparing-model.ts'
import { SAMPLE_RUN_SECONDS, sampleRuns } from '../src/features/review/preparing/sample-run.ts'
import { createReviewMemory } from '../src/features/review/state/memory.ts'

const T0 = Date.parse('2026-11-12T16:00:00Z')
const change = { project: 'hobkin-sample/storefront', item: '482', title: 'Keep the cart total between page loads', branch: 'cart', base: 'b'.repeat(40), head: 'c'.repeat(40), additions: 120, deletions: 14, files: 6 }
const summary = { level: 'high', critical: false, needsYou: 1, worthALook: 1, safe: 3, storyBy: 'model', at: '2026-11-12T10:00:00Z' } as const
/** The sample source as lane B serves it: one pull request shaped review, with its change review, for every sample id. */
const source: ReviewSource = {
  getReview: async (id) => ({ id, snapshot: 's'.repeat(64), change, nodes: [], edges: [], story: [] }) as unknown as Review,
  getFile: async (_review, fileId) => ({ fileId, path: 'a.ts', base: '', head: '', binary: false }),
  getAssessment: async () => ({ head: change.head, summary, story: '# Cart\n', units: null, triage: null, blind: null, progress: null, nodes: [] }) satisfies ChangeAssessment,
}

function open(id: string, runs: ReturnType<typeof sampleRuns>, clock: () => number) {
  return createReviewLoader({ id, scope: 'sample', memory: createReviewMemory(), command: runs(id, source), now: clock })
}

test('the sample pull request waits for "Start AI review", then its made-up run moves every second and lands on the review', async () => {
  let clock = T0
  const runs = sampleRuns(() => clock)
  const id = 'pr:hobkin-sample/api/198'
  const loader = open(id, runs, () => clock)
  await loader.load()
  assert.equal(loader.getState().status, 'awaiting')
  await loader.start()

  const said = new Set<string>()
  const percents: number[] = []
  const logs: number[] = []
  const running = new Set<string>()
  let seconds = 0
  while (loader.getState().status === 'preparing' && seconds < 90) {
    clock += 1000
    seconds += 1
    await loader.tick()
    const { preparation, startedAt } = loader.getState()
    if (!preparation || loader.getState().status !== 'preparing') continue
    const view = preparingOf(preparation, startedAt, clock)
    said.add(view.now)
    if (view.percent != null) percents.push(view.percent)
    logs.push(view.log.length)
    for (const line of view.steps) if (line.status === 'running') running.add(line.id)
    assert.equal(view.elapsed, `${seconds < 60 ? `${seconds}s` : `1m ${String(seconds - 60).padStart(2, '0')}s`}`, 'the time is the run’s own, every second')
    if (preparation.assessment?.request) assert.equal(view.subject?.title, 'Retry webhook deliveries with a backoff')
  }
  assert.equal(loader.getState().status, 'ready')
  assert.equal(loader.getState().review?.id, id)
  assert.equal(loader.getState().assessment?.story, '# Cart\n', 'it lands on the review, with its change review')
  assert.ok(seconds >= 40 && seconds <= 60, `it took ${seconds}s`)
  assert.ok(said.size >= 15, `it said ${said.size} things`)
  assert.deepEqual(percents, [...percents].sort((a, b) => a - b), 'the percent only grows')
  assert.ok(percents.at(-1)! >= 80)
  assert.ok(logs.at(-1)! > logs.find((length) => length > 0)!, 'the log grows')
  assert.deepEqual([...running], ['triage', 'map-search', 'map-proof', 'risk-floor', 'risk-model', 'shape', 'story', 'blind-check'])
  loader.dispose()
})

test('a sample run goes on with its window closed: the next window finds it under way', async () => {
  let clock = T0
  const runs = sampleRuns(() => clock)
  const id = 'pr:hobkin-sample/api/1190'
  const first = open(id, runs, () => clock)
  await first.load()
  await first.start()
  first.dispose()
  clock += 20_000
  const again = open(id, runs, () => clock)
  await again.load()
  assert.equal(again.getState().status, 'preparing')
  assert.equal(again.getState().startedAt, T0, 'it counts from when the review was asked for, not from when this window opened')
  assert.ok(preparingOf(again.getState().preparation, again.getState().startedAt, clock).steps.some((line) => line.status === 'done'))
  again.dispose()
})

test("a sample's notes are the window's own: opening it again keeps the words the window has", async () => {
  const memory = createReviewMemory()
  const id = 'pr:hobkin-sample/storefront/482'
  const mine = { ...(await source.getReview(id)), memoryScope: 'sample' } as Review
  memory.getState().setDraft(mine, { intent: 'comment', text: 'Kept words' })
  const windowNotes = (review: Review) => {
    const saved = memory.getState().of({ ...review, memoryScope: 'sample' } as Review)
    return { entries: saved.notes, draft: saved.draft }
  }
  const loader = createReviewLoader({ id, scope: 'sample', memory, command: sampleRuns(() => T0)(id, source, windowNotes), now: () => T0 })
  await loader.load()
  assert.equal(loader.getState().status, 'ready')
  assert.equal(memory.getState().of(mine).draft?.text, 'Kept words')
  loader.dispose()
})

test('"Refresh review" on an open sample runs the same over it, under way until its new review loads', async () => {
  let clock = T0
  const runs = sampleRuns(() => clock)
  const loader = open('pr:hobkin-sample/storefront/482', runs, () => clock)
  await loader.load()
  const key = () => `${loader.getState().preparation?.preparedAt}|${loader.getState().assessment?.summary.at}`
  const before = key()
  assert.equal(loader.getState().status, 'ready')
  assert.equal(underWay(loader.getState().preparation), false)

  await loader.refresh()
  assert.equal(loader.getState().status, 'ready', 'the review stays open')
  assert.equal(underWay(loader.getState().preparation), true)
  let seconds = 0
  while (underWay(loader.getState().preparation) && seconds < 90) {
    clock += 1000
    seconds += 1
    await loader.tick()
    assert.equal(loader.getState().status, 'ready')
  }
  assert.ok(Math.abs(seconds - SAMPLE_RUN_SECONDS) <= 1, `it ran ${seconds}s`)
  assert.notEqual(key(), before, 'a new review loads, so the stage starts again on it')
  assert.equal(loader.getState().assessment?.summary.at, new Date(T0 + SAMPLE_RUN_SECONDS * 1000).toISOString())
  loader.dispose()
})
