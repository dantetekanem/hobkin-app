import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agoWords, groupReviews, type ReviewListItem } from '../src/features/work/ai-reviews.ts'

const item = (id: string, over: Partial<ReviewListItem>): ReviewListItem => ({ id, kind: 'change', title: id, project: 'p', head: 'h', state: 'ready', phase: null, updatedAt: '2026-11-12T10:00:00Z', ...over })

test('reviews are grouped as running, ready and failed, in the host order', () => {
  const groups = groupReviews({ reviews: [
    item('a', { state: 'preparing', phase: 'reading' }),
    item('b', { assessment: { state: 'running', head: 'h', percent: 33.3, now: 'Mapping' } }),
    item('c', { assessment: { state: 'ready', head: 'h' } }),
    item('d', { state: 'failed', error: 'gh is not signed in' }),
    item('e', { assessment: { state: 'failed', head: 'h', error: 'model refused' } }),
  ] })
  assert.deepEqual(groups.running.map((r) => r.item.id), ['a', 'b'])
  assert.deepEqual(groups.ready.map((r) => r.item.id), ['c'])
  assert.deepEqual(groups.failed.map((r) => [r.item.id, r.line]), [['d', 'gh is not signed in'], ['e', 'model refused']])
  assert.equal(groups.running[0]!.line, 'Reading the change')
  assert.deepEqual([groups.running[1]!.percent, groups.running[1]!.line], [33, 'Mapping'])
})

test('times read as words', () => {
  const now = Date.parse('2026-11-12T10:10:00Z')
  assert.equal(agoWords('2026-11-12T10:09:50Z', now), 'just now')
  assert.equal(agoWords('2026-11-12T10:00:00Z', now), '10 min ago')
  assert.equal(groupReviews(null).ready.length, 0)
})
