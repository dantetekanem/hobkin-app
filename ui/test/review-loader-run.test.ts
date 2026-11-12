import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AssessmentStatus, ChangeAssessment } from '../../shared/review/assessment.ts'
import { IDLE_STATUS, type OpenedReview, type ReviewStatus } from '../../shared/review/status.ts'
import type { Review } from '../../shared/review/types.ts'
import { createReviewLoader, type ReviewCommands } from '../src/features/review/loader.ts'
import { failureOf, underWay } from '../src/features/review/preparing-model.ts'
import { createReviewMemory } from '../src/features/review/state/memory.ts'

const id = 'pr:owner/repo/78'
const T0 = Date.parse('2026-11-12T16:00:00Z')
const iso = (seconds: number) => new Date(T0 + seconds * 1000).toISOString()
const review = { id, snapshot: 'a'.repeat(64), change: { head: 'h' }, nodes: [], edges: [], story: [] } as unknown as Review
const summary = { level: 'mid', critical: false, needsYou: 0, worthALook: 2, safe: 3, storyBy: 'model', at: iso(50) } as const
const finished: ChangeAssessment = { head: 'h', summary, story: '# Story\n', units: null, triage: null, blind: null, progress: null, nodes: [] }
const graphReady = (assessment: AssessmentStatus): ReviewStatus => ({ ...IDLE_STATUS(id), state: 'ready', head: 'h', preparedAt: iso(4), assessment })

/** A host that answers each status with the next one it is given, and keeps the last. */
function host(statuses: ReviewStatus[], prepared?: ReviewStatus) {
  const calls: string[] = []
  let at = 0
  let current = statuses[0]!
  const command = (async (name: string) => {
    calls.push(name)
    if (name === 'review.status') return (current = statuses[Math.min(at++, statuses.length - 1)]!)
    if (name === 'review.prepare') return (current = prepared ?? current)
    if (name === 'review.get') return { review, notes: { entries: [], draft: null }, status: current, assessment: current.assessment?.state === 'ready' ? finished : null } satisfies OpenedReview
    if (name === 'review.notes') return { ok: true }
    throw new Error(name)
  }) as ReviewCommands
  let clock = T0 + 3000
  const loader = createReviewLoader({ id, scope: 'host:/fixture', command, memory: createReviewMemory(), now: () => clock })
  return { loader, calls, gets: () => calls.filter((name) => name === 'review.get').length, wait: (ms: number) => { clock += ms } }
}

test('a pull request stays on the preparing view until its first change review is ready, whatever the host calls its state', async () => {
  const { loader, gets, wait } = host([
    { ...IDLE_STATUS(id), state: 'preparing', phase: 'reading', startedAt: iso(0) },
    graphReady({ state: 'running', head: 'h', percent: 10, now: 'triage: 9 files sorted', startedAt: iso(4) }),
    graphReady({ state: 'running', head: 'h', percent: 60, now: 'map-proof: node run, exit 0', startedAt: iso(4) }),
    graphReady({ state: 'ready', head: 'h', summary }),
  ])
  await loader.load()
  assert.equal(loader.getState().status, 'preparing')
  // The run's time is the host's, from when it was asked for, not from when this window first saw it.
  assert.equal(loader.getState().startedAt, T0)

  for (const percent of [10, 60]) {
    wait(1000)
    await loader.tick()
    const state = loader.getState()
    assert.deepEqual([state.status, state.review, state.preparation?.assessment?.percent], ['preparing', null, percent])
    assert.equal(state.startedAt, T0, 'the time goes on from the graph to its change review')
  }
  assert.equal(gets(), 0, 'its half-built review is never fetched')

  wait(1000)
  await loader.tick()
  const opened = loader.getState()
  assert.deepEqual([opened.status, opened.review?.id, opened.assessment?.story, opened.startedAt], ['ready', id, '# Story\n', null])
  assert.equal(gets(), 1)
  loader.dispose()
})

test('a pull request whose change review stopped opens on its graph and says why', async () => {
  const { loader } = host([graphReady({ state: 'failed', head: 'h', error: 'The tests did not finish in time.' })])
  await loader.load()
  assert.equal(loader.getState().status, 'ready')
  assert.equal(loader.getState().assessment, null)
  assert.equal(failureOf(loader.getState().preparation), 'The tests did not finish in time.')
  loader.dispose()
})

test('a pull request whose change review is under way is followed, never offered "Start AI review" again', async () => {
  const running: AssessmentStatus = { state: 'running', head: 'h', percent: 30, startedAt: iso(0) }
  // Even a host that calls the review idle while its change review runs.
  const idle = host([{ ...IDLE_STATUS(id), head: 'h', assessment: running }])
  await idle.loader.load()
  assert.equal(idle.loader.getState().status, 'preparing')
  assert.deepEqual(idle.calls, ['review.status'])
  idle.loader.dispose()

  // "Start AI review", answered with a graph that is ready at once: it still waits for the change review.
  const started = host([IDLE_STATUS(id)], graphReady(running))
  await started.loader.load()
  assert.equal(started.loader.getState().status, 'awaiting')
  await started.loader.start()
  assert.equal(started.loader.getState().status, 'preparing')
  assert.equal(started.gets(), 0)
  assert.ok(underWay(started.loader.getState().preparation))
  started.loader.dispose()
})
