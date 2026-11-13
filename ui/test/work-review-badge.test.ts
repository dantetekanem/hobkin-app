import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sinceLastReview, type AssessmentStatus, type AssessmentSummary } from '../../shared/review/assessment.ts'
import { reviewBadge, saysHigh } from '../src/features/work/review-badge.ts'

const HEAD = 'f3a9c1e7'.padEnd(40, '0')

const ready = (summary: Partial<AssessmentSummary>): AssessmentStatus => ({
  state: 'ready',
  head: HEAD,
  summary: { level: 'safe', critical: false, needsYou: 0, worthALook: 0, safe: 0, storyBy: 'model', at: '2026-11-12T10:00:00.000Z', ...summary },
})

test('a ready change review gives one answer for the whole change: risky or safe to deploy, with why under the pointer', () => {
  // Risky only when a part can break. The count of parts is not on the badge: the answer is about the change.
  assert.deepEqual(reviewBadge(ready({ level: 'high', needsYou: 2, worthALook: 1, safe: 4 })), {
    label: 'Risky to deploy',
    tone: 'bad',
    critical: false,
    title: '2 parts can break.',
  })
  // The host's own reason, when it gave one.
  assert.equal(reviewBadge(ready({ level: 'high', needsYou: 1, deploy: 'risky', why: '`charge` breaks a test that passes without this change.' })).title, '`charge` breaks a test that passes without this change.')

  // What no test showed is no risk: the change is safe to deploy, and the line says what was not shown.
  assert.deepEqual(reviewBadge(ready({ level: 'mid', worthALook: 3, safe: 1 })), {
    label: 'Safe to deploy',
    tone: 'ok',
    critical: false,
    title: 'Nothing found that breaks. 3 parts were not shown working by a test that ran.',
  })
  assert.deepEqual(reviewBadge(ready({ level: 'safe', safe: 5 })), { label: 'Safe to deploy', tone: 'ok', critical: false, title: 'Every part is shown to work, or cannot break anything.' })
})

test('a critical finding is marked, and only a review that says risky holds the merge back', () => {
  const critical = reviewBadge(ready({ level: 'high', critical: true, needsYou: 1 }))
  assert.equal(critical.critical, true)
  assert.equal(critical.title, '1 part can break. It needs a fix, not only a look.')

  assert.equal(saysHigh(ready({ level: 'high', needsYou: 1 })), true)
  const notHigh: (AssessmentStatus | undefined)[] = [
    ready({ level: 'mid', worthALook: 1 }),
    ready({ level: 'safe', safe: 1 }),
    { state: 'running', head: HEAD, percent: 50 },
    { state: 'failed', head: HEAD, error: 'The tests would not start.' },
    undefined,
  ]
  for (const status of notHigh) assert.equal(saysHigh(status), false, status?.state ?? 'none')
})

test('a review under way says how far along it is, with what it is doing as its title, and one waiting says it is queued', () => {
  const now = 'map-proof: finding how this repository runs its tests'
  assert.deepEqual(reviewBadge({ state: 'running', head: HEAD, percent: 40.4, now }), { label: 'Reviewing · 40%', tone: 'quiet', critical: false, title: now })
  assert.equal(reviewBadge({ state: 'running', head: HEAD }).label, 'Reviewing')

  const queued = reviewBadge({ state: 'queued', head: HEAD })
  assert.equal(queued.label, 'Review queued')
  assert.equal(queued.tone, 'quiet')
})

test('a failed review says why in its title, and a change with none says it is not reviewed yet', () => {
  assert.deepEqual(reviewBadge({ state: 'failed', head: HEAD, error: 'The tests would not start.' }), {
    label: 'Review failed',
    tone: 'quiet',
    critical: false,
    title: 'The tests would not start.',
  })

  const none: (AssessmentStatus | undefined)[] = [{ state: 'idle', head: HEAD }, { state: 'idle', head: null }, undefined]
  for (const status of none) {
    const badge = reviewBadge(status)
    assert.equal(badge.label, 'Not reviewed yet')
    assert.equal(badge.tone, 'quiet')
  }
})

test('a review that comes after another says whether the code changed and whether the answer did', () => {
  const before = { head: 'aaaaaaa11111', deploy: 'risky' as const, at: '2026-11-12T09:00:00.000Z' }
  assert.equal(sinceLastReview({ level: 'high', before }, 'aaaaaaa11111'.padEnd(40, '0')), 'Reviewed again at the same commit, aaaaaaa: no code changed since the last review. The answer is the same: risky to deploy.')
  assert.equal(
    sinceLastReview({ level: 'safe', before }, 'bbbbbbb22222'.padEnd(40, '0')),
    'The last review was of aaaaaaa, and this one is of bbbbbbb: the code changed in between. The answer went from risky to deploy to safe to deploy.',
  )
  assert.equal(sinceLastReview({ level: 'safe' }, 'bbbbbbb22222'), null, 'a first review comes after none')
})
