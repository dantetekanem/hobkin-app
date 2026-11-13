import assert from 'node:assert/strict'
import test from 'node:test'
import { prune, readDismissals, withDismissal } from '../src/features/home/dismissals.ts'

const DAY = 24 * 3_600_000
const now = 100 * DAY

test('withDismissal records a time once and keeps the first one', () => {
  const first = withDismissal({}, 'problem:a', now)
  assert.deepEqual(first, { 'problem:a': now })
  // Dismissing the same id again keeps the original record untouched.
  const again = withDismissal(first, 'problem:a', now + DAY)
  assert.equal(again, first)
  assert.equal(again['problem:a'], now)
})

test('prune forgets dismissals older than the age limit and caps the newest', () => {
  const stale = now - 61 * DAY
  const kept = prune({ old: stale, recent: now - DAY, bad: Number.NaN }, now)
  assert.deepEqual(Object.keys(kept), ['recent'])

  const many = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`id${i}`, now - i * 1000]))
  const capped = prune(many, now)
  assert.equal(Object.keys(capped).length, 400)
  // The newest survive: id0 has the latest time, id499 the oldest.
  assert.ok('id0' in capped)
  assert.equal('id499' in capped, false)
})

test('readDismissals parses, prunes, and treats anything malformed as empty', () => {
  assert.deepEqual(readDismissals(JSON.stringify({ 'problem:a': now }), now), { 'problem:a': now })
  assert.deepEqual(readDismissals(JSON.stringify({ old: now - 61 * DAY }), now), {})
  for (const bad of [null, '[]', '"x"', '{bad', '42']) {
    assert.deepEqual(readDismissals(bad, now), {})
  }
})
