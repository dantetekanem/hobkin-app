import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssessmentStatus, ChangeAssessment } from '../../shared/review/assessment.ts'
import { IDLE_STATUS, type OpenedReview, type ReviewStatus } from '../../shared/review/status.ts'
import type { Review } from '../../shared/review/types.ts'
import { createReviewLoader, waitsForReview, type ReviewCommands } from '../src/features/review/loader.ts'
import { ReviewLoad } from '../src/features/review/ReviewLoad.ts'
import type { ReviewLook } from '../src/features/review/state/look.ts'
import { createReviewMemory } from '../src/features/review/state/memory.ts'

/**
 * How a review loads in each look (spec 071): the code look opens on the diff as soon as the graph is built and never
 * asks for the change review; the graph look asks for it, waits for it as before, and shows its progress when the look
 * becomes Graph over a review the code look opened.
 */

const CHANGE = 'change:shop:4c9e21'
const PULL = 'pr:acme/shop/12'
const HEAD = 'a'.repeat(40)
const NEWER = 'b'.repeat(40)
const T0 = Date.parse('2026-11-25T09:00:00Z')
const summary = { level: 'mid', critical: false, needsYou: 0, worthALook: 2, safe: 3, storyBy: 'model', at: new Date(T0).toISOString() } as const
const finished: ChangeAssessment = { head: HEAD, summary, story: '# Story\n', units: null, triage: null, blind: null, progress: null, nodes: [] }

const idle: AssessmentStatus = { state: 'idle', head: HEAD }
const queued: AssessmentStatus = { state: 'queued', head: HEAD, percent: 0 }
const running: AssessmentStatus = { state: 'running', head: HEAD, percent: 40 }
const ready: AssessmentStatus = { state: 'ready', head: HEAD, summary }
const failed: AssessmentStatus = { state: 'failed', head: HEAD, error: 'The tests did not finish in time.' }

const building = (id: string): ReviewStatus => ({ ...IDLE_STATUS(id), state: 'preparing', phase: 'reading', startedAt: new Date(T0).toISOString() })
/** A review whose graph is built at the change's commit, with its change review as given. */
const built = (id: string, assessment: AssessmentStatus): ReviewStatus => ({ ...IDLE_STATUS(id), state: 'ready', head: HEAD, preparedAt: new Date(T0).toISOString(), assessment })

/** A host that answers with the status it was last told, and writes down every ask with its arguments. */
function hostOf(id: string, look: ReviewLook, { old = false }: { old?: boolean } = {}) {
  const asks: { name: string; args: Record<string, unknown> }[] = []
  let status: ReviewStatus = IDLE_STATUS(id)
  let onPrepare: ((args: Record<string, unknown>) => ReviewStatus) | null = null
  const review = { id, snapshot: 's'.repeat(64), change: { head: HEAD }, nodes: [], edges: [], story: [] } as unknown as Review
  const command = (async (name: string, args: Record<string, unknown>) => {
    asks.push({ name, args })
    if (name === 'review.prepare') {
      // A host from before spec 071 refuses the argument it does not know.
      if (old && 'changeReview' in args) throw Object.assign(new Error('review.prepare: arguments must not have "changeReview".'), { code: 'invalid-arguments' })
      if (onPrepare) status = onPrepare(args)
      return status
    }
    if (name === 'review.status') return status
    if (name === 'review.get') return { review, notes: { entries: [], draft: null }, status, assessment: status.assessment?.state === 'ready' ? finished : null } satisfies OpenedReview
    if (name === 'review.notes') return { ok: true }
    throw new Error(name)
  }) as ReviewCommands
  const loader = createReviewLoader({ id, scope: 'host:/fixture', command, memory: createReviewMemory(), look, now: () => T0 })
  return {
    loader,
    say: (next: ReviewStatus) => void (status = next),
    answerPrepare: (answer: (args: Record<string, unknown>) => ReviewStatus) => void (onPrepare = answer),
    prepares: () => asks.filter((ask) => ask.name === 'review.prepare').map((ask) => ask.args),
    gets: () => asks.filter((ask) => ask.name === 'review.get').length,
  }
}

test('in the code look a review opens on its diff once its graph is built, and its change review is never asked for, a pull request’s too', async () => {
  for (const id of [CHANGE, PULL]) {
    const host = hostOf(id, 'code')
    host.answerPrepare(() => building(id))
    await host.loader.load()
    assert.deepEqual(host.prepares(), [{ id, changeReview: false }], id)
    assert.equal(host.loader.getState().status, 'preparing', 'it waits for the graph, not for "Start AI review"')

    host.say(built(id, idle))
    await host.loader.tick()
    const { status, review } = host.loader.getState()
    assert.deepEqual([status, review?.id], ['ready', id])
    assert.deepEqual(host.prepares(), [{ id, changeReview: false }], 'nothing more is asked')
    host.loader.dispose()
  }
})

test('in the code look a change review under way does not hold the review back, and one that is ready shows', async () => {
  const under = hostOf(CHANGE, 'code')
  under.say(built(CHANGE, running))
  await under.loader.load()
  assert.equal(under.loader.getState().status, 'ready')
  assert.equal(under.gets(), 1)
  assert.deepEqual(under.prepares(), [])
  under.loader.dispose()

  const rated = hostOf(CHANGE, 'code')
  rated.say(built(CHANGE, ready))
  await rated.loader.load()
  assert.equal(rated.loader.getState().assessment?.story, '# Story\n')
  rated.loader.dispose()
})

test('a host from before the code look refuses changeReview: a finished change is asked for as before, and a pull request waits for "Start AI review"', async () => {
  const change = hostOf(CHANGE, 'code', { old: true })
  await change.loader.load()
  assert.deepEqual(change.prepares(), [{ id: CHANGE, changeReview: false }, { id: CHANGE }])
  change.loader.dispose()

  const pull = hostOf(PULL, 'code', { old: true })
  await pull.loader.load()
  assert.deepEqual(pull.prepares(), [{ id: PULL, changeReview: false }])
  assert.equal(pull.loader.getState().status, 'awaiting')
  pull.loader.dispose()
})

test('opening in the graph, a graph built alone has its change review asked for and waited on; a pull request waits for "Start AI review"', async () => {
  const change = hostOf(CHANGE, 'graph')
  change.say(built(CHANGE, idle))
  change.answerPrepare(() => ({ ...built(CHANGE, queued), phase: 'queued' }))
  await change.loader.load()
  assert.deepEqual(change.prepares(), [{ id: CHANGE }])
  assert.equal(change.loader.getState().status, 'preparing')
  assert.equal(change.gets(), 0, 'its graph alone is not opened')
  change.loader.dispose()

  const pull = hostOf(PULL, 'graph')
  pull.say(built(PULL, idle))
  await pull.loader.load()
  assert.deepEqual(pull.prepares(), [])
  assert.equal(pull.loader.getState().status, 'awaiting')
  pull.loader.dispose()

  // Only the first look asks: one that later finds no change review, as after a stop while the graph was drawn, opens the graph as it is.
  const stopped = hostOf(CHANGE, 'graph')
  stopped.say(built(CHANGE, idle))
  stopped.answerPrepare(() => ({ ...built(CHANGE, queued), phase: 'queued' }))
  await stopped.loader.load()
  stopped.say(built(CHANGE, idle))
  await stopped.loader.tick()
  assert.equal(stopped.loader.getState().status, 'ready')
  assert.equal(stopped.prepares().length, 1)
  stopped.loader.dispose()
})

test('Code to Graph starts the change review the code look did not ask for, and the graph look shows its progress until it is ready', async () => {
  const host = hostOf(CHANGE, 'code')
  host.say(built(CHANGE, idle))
  await host.loader.load()
  assert.equal(waitsForReview(host.loader.getState()), false)

  host.answerPrepare(() => ({ ...built(CHANGE, queued), phase: 'queued' }))
  const asking = host.loader.setLook('graph')
  assert.equal(waitsForReview(host.loader.getState()), true, 'from the moment it is asked for')
  await asking
  assert.deepEqual(host.prepares(), [{ id: CHANGE }])
  assert.equal(waitsForReview(host.loader.getState()), true)

  // Back to the code and to the graph again while it runs: it goes on, and nothing more is asked.
  host.say(built(CHANGE, running))
  await host.loader.tick()
  await host.loader.setLook('code')
  await host.loader.setLook('graph')
  assert.equal(host.prepares().length, 1)
  assert.equal(waitsForReview(host.loader.getState()), true)

  host.say(built(CHANGE, ready))
  await host.loader.tick()
  assert.equal(host.loader.getState().assessment?.story, '# Story\n', 'the review is fetched again with its story')
  assert.equal(waitsForReview(host.loader.getState()), false)
  host.loader.dispose()
})

test('Code to Graph asks nothing when the change review is under way, ready or stopped, or the review is of an older commit', async () => {
  const cases: [string, ReviewStatus, boolean][] = [
    ['under way', built(CHANGE, running), true],
    ['ready', built(CHANGE, ready), false],
    ['stopped', built(CHANGE, failed), false],
    ['outdated', { ...built(CHANGE, { state: 'idle', head: NEWER }), head: NEWER, stale: true }, false],
  ]
  for (const [name, status, waits] of cases) {
    const host = hostOf(CHANGE, 'code')
    host.say(status)
    await host.loader.load()
    await host.loader.setLook('graph')
    assert.deepEqual(host.prepares(), [], name)
    assert.equal(waitsForReview(host.loader.getState()), waits, name)
    host.loader.dispose()
  }
})

test('a run asked for in the graph over a review the code look opened shows over the graph, as any rebuild does', async () => {
  const host = hostOf(CHANGE, 'code')
  host.say(built(CHANGE, running))
  await host.loader.load()
  await host.loader.setLook('graph')
  host.say(built(CHANGE, failed))
  await host.loader.tick()
  assert.equal(waitsForReview(host.loader.getState()), false, 'stopped: the graph shows, with why')

  // "Try again" builds it again: the graph stays on screen with the run over it.
  host.answerPrepare(() => ({ ...built(CHANGE, running), phase: 'queued' }))
  await host.loader.refresh()
  assert.deepEqual(host.prepares(), [{ id: CHANGE, refresh: true }])
  assert.equal(waitsForReview(host.loader.getState()), false)
  host.loader.dispose()
})

test('in the code look nothing floats in the corner: no run, no Refresh review and nothing beside it, and the graph look that waits shows no run card of its own', async () => {
  const host = hostOf(CHANGE, 'code')
  host.say(built(CHANGE, running))
  await host.loader.load()
  const corner = () =>
    renderToStaticMarkup(
      createElement(ReviewLoad, {
        loader: host.loader,
        renderReview: () => null,
        renderRun: () => createElement('p', null, 'The run'),
        renderBeside: (_review, _status, action) => createElement('div', null, 'Make it a stack', action),
      }),
    )
  assert.equal(corner().includes('The run'), false)
  assert.equal(corner().includes('Make it a stack'), false)
  assert.equal(corner().includes('Refresh review'), false)

  // The graph look waits for the change review: its progress is the page, not a card in the corner.
  await host.loader.setLook('graph')
  assert.equal(corner().includes('The run'), false)
  assert.equal(corner().includes('Refresh review'), false)

  // Once it has stopped, the graph shows with the run's card, as before.
  host.say(built(CHANGE, failed))
  await host.loader.tick()
  assert.ok(corner().includes('The run'))
  assert.ok(corner().includes('Make it a stack'))
  host.loader.dispose()
})

test('the page that waits for a review hears which look it is for', async () => {
  const host = hostOf(CHANGE, 'code')
  host.answerPrepare(() => building(CHANGE))
  await host.loader.load()
  const seen: unknown[] = []
  renderToStaticMarkup(createElement(ReviewLoad, { loader: host.loader, renderReview: () => null, renderWaiting: (...given) => void seen.push(given) }))
  assert.deepEqual(seen, [['preparing', null, 'code']])
  host.loader.dispose()
})
