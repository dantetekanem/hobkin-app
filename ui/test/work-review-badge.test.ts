import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AssessmentStatus, AssessmentSummary } from '../../shared/review/assessment.ts'
import { reviewBadge, saysHigh } from '../src/features/work/review-badge.ts'

const HEAD = 'f3a9c1e7'.padEnd(40, '0')

const ready = (summary: Partial<AssessmentSummary>): AssessmentStatus => ({
  state: 'ready',
  head: HEAD,
  summary: { level: 'safe', critical: false, needsYou: 0, worthALook: 0, safe: 0, storyBy: 'model', at: '2026-11-12T10:00:00.000Z', ...summary },
})

test('a ready change review shows its level in words, with how many units are at it when there are more than one', () => {
  assert.deepEqual(reviewBadge(ready({ level: 'high', needsYou: 2, worthALook: 1, safe: 4 })), {
    label: 'High risk · 2',
    tone: 'bad',
    critical: false,
    title: 'Change review: 2 units need you, 1 is worth a look and 4 are safe.',
  })
  assert.equal(reviewBadge(ready({ level: 'high', needsYou: 1, safe: 3 })).label, 'High risk')

  assert.deepEqual(reviewBadge(ready({ level: 'mid', worthALook: 3, safe: 1 })), {
    label: 'Mid risk · 3',
    tone: 'warn',
    critical: false,
    title: 'Change review: 3 units are worth a look and 1 is safe.',
  })
  assert.equal(reviewBadge(ready({ level: 'mid', worthALook: 1 })).label, 'Mid risk')

  assert.deepEqual(reviewBadge(ready({ level: 'safe', safe: 5 })), { label: 'Safe', tone: 'ok', critical: false, title: 'Change review: 5 units are safe.' })
})

test('a critical finding is marked and named, and only a ready review at high holds the merge back', () => {
  const critical = reviewBadge(ready({ level: 'high', critical: true, needsYou: 1 }))
  assert.equal(critical.critical, true)
  assert.equal(critical.title, 'Change review: 1 unit needs you. Something in it is critical.')

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
