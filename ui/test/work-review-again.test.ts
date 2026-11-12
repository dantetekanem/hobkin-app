import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AssessmentStatus } from '../../shared/review/assessment.ts'
import { IDLE_STATUS, type ReviewStatus } from '../../shared/review/status.ts'
import { followChangeReview, type ChangeReviewCommands } from '../src/features/work/review-follow.ts'

const ID = 'change:billing-api:0f6a3b'
const HEAD = '51d8a3be'.padEnd(40, '0')
const READY: AssessmentStatus = {
  state: 'ready',
  head: HEAD,
  summary: { level: 'mid', critical: false, needsYou: 0, worthALook: 1, safe: 2, storyBy: 'model', at: '2026-11-12T10:00:00.000Z' },
}

const answered = () => new Promise((resolve) => setImmediate(resolve))

/** Every command the card sends, and a host that answers them as the real one does. */
function host() {
  const sent: [string, unknown][] = []
  const at = {
    status: { ...IDLE_STATUS(ID), state: 'ready', head: HEAD, assessment: READY } as ReviewStatus,
    refuse: null as string | null,
  }
  const run = (async (name, args) => {
    sent.push([name, args])
    if (name === 'review.prepare') {
      if (at.refuse) throw new Error(at.refuse)
      // The host prepares the review again first, and starts its change review once that is done.
      at.status = { ...at.status, phase: 'queued' }
    }
    return at.status
  }) as ChangeReviewCommands
  return { sent, at, run }
}

test("Review again asks the host to prepare the review again and never runs hobkin's review action", async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { sent, at, run } = host()
  const shown: (string | undefined)[] = []
  const follow = followChangeReview({ id: ID, run, onStatus: (status) => shown.push(status?.state === 'running' ? `running ${status.percent}%` : status?.state) })
  await answered()

  await follow.again()
  assert.deepEqual(sent, [
    ['review.status', { id: ID }],
    ['review.prepare', { id: ID, refresh: true }],
  ])
  assert.ok(
    sent.every(([name]) => name.startsWith('review.')),
    'no work action reaches hobkin, so no agent review starts',
  )
  assert.equal(shown.at(-1), 'queued', 'the card shows it queued at once, while the host prepares the review again')

  // The review is ready again and its change review runs: the card follows it until it is ready, then stops.
  at.status = { ...at.status, phase: null, assessment: { state: 'running', head: HEAD, percent: 25, now: 'map-proof: finding how this repository runs its tests' } }
  t.mock.timers.tick(5_000)
  await answered()
  at.status = { ...at.status, assessment: { ...READY, summary: { ...READY.summary!, level: 'high', needsYou: 1 } } }
  t.mock.timers.tick(5_000)
  await answered()
  t.mock.timers.tick(30_000)
  await answered()

  assert.deepEqual(shown, ['ready', 'queued', 'running 25%', 'ready'])
  assert.deepEqual(
    sent.map(([name]) => name),
    ['review.status', 'review.prepare', 'review.status', 'review.status'],
  )
})

test('a refused Review again comes back with the host’s reason, and the card goes on showing what it had', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { at, run } = host()
  const shown: (string | undefined)[] = []
  const follow = followChangeReview({ id: ID, run, onStatus: (status) => shown.push(status?.state) })
  await answered()

  at.refuse = 'This change has no branch to read any more.'
  await assert.rejects(follow.again(), /no branch to read any more/)
  assert.deepEqual(shown, ['ready'])
})
