import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AssessmentStatus } from '../../shared/review/assessment.ts'
import { IDLE_STATUS, type PreparePhase, type ReviewStatus } from '../../shared/review/status.ts'
import { followChangeReview, type ChangeReviewCommands } from '../src/features/work/review-follow.ts'

const ID = 'change:storefront:d2c4e8'
const HEAD = 'c0ffee12'.padEnd(40, '0')
const READY: AssessmentStatus = {
  state: 'ready',
  head: HEAD,
  summary: { level: 'mid', critical: false, needsYou: 0, worthALook: 2, safe: 3, storyBy: 'model', at: '2026-11-12T10:00:00.000Z' },
}

interface FakeHost {
  assessment: AssessmentStatus | undefined
  phase: PreparePhase | null
  asked: number
  failNext: boolean
  run: ChangeReviewCommands
}

/** A host whose change review the test moves along. It counts how often it was asked, and can fail once. */
function hostAt(assessment: AssessmentStatus | undefined, phase: PreparePhase | null = null): FakeHost {
  const host: FakeHost = {
    assessment,
    phase,
    asked: 0,
    failNext: false,
    run: (async (name, args) => {
      assert.equal(name, 'review.status')
      assert.deepEqual(args, { id: ID })
      host.asked += 1
      if (host.failNext) {
        host.failNext = false
        throw new Error('The host is not answering.')
      }
      const status: ReviewStatus = { ...IDLE_STATUS(ID), state: 'ready', head: HEAD, phase: host.phase }
      return host.assessment ? { ...status, assessment: host.assessment } : status
    }) as ChangeReviewCommands,
  }
  return host
}

/** Lets the host's answers in. */
const answered = () => new Promise((resolve) => setImmediate(resolve))

test('a card asks how its change review stands at once, every five seconds while it is queued or running, and no more once it is ready', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const host = hostAt({ state: 'queued', head: HEAD })
  const shown: (string | undefined)[] = []
  followChangeReview({ id: ID, run: host.run, onStatus: (status) => shown.push(status?.state) })
  await answered()
  assert.equal(host.asked, 1, 'asked once, when the card mounts')

  host.assessment = { state: 'running', head: HEAD, percent: 40, now: 'triage: 3 files sorted into 2 buckets' }
  t.mock.timers.tick(4_999)
  await answered()
  assert.equal(host.asked, 1, 'not before five seconds')
  t.mock.timers.tick(1)
  await answered()
  assert.equal(host.asked, 2)

  host.assessment = READY
  t.mock.timers.tick(5_000)
  await answered()
  t.mock.timers.tick(30_000)
  await answered()
  assert.equal(host.asked, 3, 'a ready review is not asked about again')
  assert.deepEqual(shown, ['queued', 'running', 'ready'])
})

test('a review that has not started yet is asked about again every thirty seconds, so the card sees the background start it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const host = hostAt({ state: 'idle', head: HEAD })
  followChangeReview({ id: ID, run: host.run, onStatus: () => {} })
  await answered()
  t.mock.timers.tick(5_000)
  await answered()
  assert.equal(host.asked, 1, 'not as often as one under way')
  t.mock.timers.tick(25_000)
  await answered()
  assert.equal(host.asked, 2)
})

test('it asks only once about a review that failed, or that this host does not run', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const cases: { assessment: AssessmentStatus | undefined; phase?: PreparePhase }[] = [
    { assessment: { state: 'failed', head: HEAD, error: 'The tests would not start.' } },
    // An older host says nothing of change reviews, even while it prepares the review itself.
    { assessment: undefined, phase: 'queued' },
  ]
  for (const { assessment, phase } of cases) {
    const host = hostAt(assessment, phase)
    const shown: (AssessmentStatus | undefined)[] = []
    followChangeReview({ id: ID, run: host.run, onStatus: (status) => shown.push(status) })
    await answered()
    t.mock.timers.tick(30_000)
    await answered()
    assert.equal(host.asked, 1, assessment?.state ?? 'no change review')
    assert.deepEqual(shown, [assessment])
  }
})

test('once the card goes away nothing more is asked, and an answer still on its way is dropped', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const host = hostAt({ state: 'running', head: HEAD, percent: 10 })
  const shown: unknown[] = []
  const follow = followChangeReview({ id: ID, run: host.run, onStatus: (status) => shown.push(status) })
  follow.stop()
  await answered()
  t.mock.timers.tick(30_000)
  await answered()
  assert.equal(host.asked, 1)
  assert.deepEqual(shown, [])
})

test('an ask that fails while the review is under way is asked again five seconds later', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const host = hostAt({ state: 'running', head: HEAD, percent: 10 })
  const shown: (string | undefined)[] = []
  followChangeReview({ id: ID, run: host.run, onStatus: (status) => shown.push(status?.state) })
  await answered()

  host.failNext = true
  t.mock.timers.tick(5_000)
  await answered()
  assert.equal(host.asked, 2)

  host.assessment = READY
  t.mock.timers.tick(5_000)
  await answered()
  assert.equal(host.asked, 3)
  assert.deepEqual(shown, ['running', 'ready'], 'the failed ask changed nothing on the card')
})
