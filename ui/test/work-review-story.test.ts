import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Grade } from '#shared/protocol/work.ts'
import type { AssessmentSummary } from '#shared/review/assessment.ts'
import type { ReviewListItem } from '#shared/review/status.ts'
import { groupReviews, rowsOf, type ReviewRow } from '../src/features/work/ai-reviews.ts'
import { advanceStory, offersStory, sortStory, startStory, storyPlace, waitingRows } from '../src/features/work/review-story.ts'

const HEAD = 'f3a9c1e7'.padEnd(40, '0')
const summary = (over: Partial<AssessmentSummary> = {}): AssessmentSummary => ({ level: 'safe', critical: false, needsYou: 0, worthALook: 0, safe: 1, storyBy: 'model', at: '2026-11-24T12:00:00Z', ...over })
const ready = (id: string, over: Partial<ReviewListItem> = {}, sum: Partial<AssessmentSummary> = {}): ReviewListItem => ({
  id: `change:shop:${id}`,
  kind: 'change',
  title: id,
  project: 'shop',
  head: HEAD,
  state: 'ready',
  phase: null,
  error: null,
  updatedAt: '2026-11-24T12:00:00Z',
  assessment: { state: 'ready', head: HEAD, summary: summary(sum) },
  ...over,
})
const ids = (rows: ReviewRow[]) => rows.map((row) => row.item.id.replace('change:shop:', ''))
const rowsFor = (items: ReviewListItem[], grades: Record<string, Grade> = {}) => rowsOf({ reviews: items }, (item) => grades[item.id.replace('change:shop:', '')] ?? null)

test('highest priority first, then safest, then smallest, and ties keep the list order', () => {
  const rows = rowsFor(
    [
      ready('big-safe', { lines: 400 }),
      ready('small-safe', { lines: 20 }),
      ready('risky', { lines: 5 }, { level: 'high', deploy: 'risky' }),
      ready('p0-risky', { lines: 5 }, { level: 'high', deploy: 'risky' }),
      ready('critical', { lines: 5 }, { level: 'high', deploy: 'risky', critical: true }),
      ready('tie-a', { lines: 20 }),
      ready('tie-b', { lines: 20 }),
    ],
    { 'p0-risky': 'P0', 'big-safe': 'P2', 'small-safe': 'P2', risky: 'P2', critical: 'P2', 'tie-a': 'P2', 'tie-b': 'P2' },
  )
  assert.deepEqual(ids(sortStory(rows)), ['p0-risky', 'small-safe', 'tie-a', 'tie-b', 'big-safe', 'risky', 'critical'])
})

test('a stack stays together, bottom layer first, at the place of its best layer', () => {
  const rows = rowsFor([ready('top', { lines: 10 }), ready('lone', { lines: 50 }), ready('bottom', { lines: 900 }), ready('mid', { lines: 300 })])
  const layers: Record<string, { id: string; layer: number }> = { bottom: { id: 's', layer: 1 }, mid: { id: 's', layer: 2 }, top: { id: 's', layer: 3 } }
  const stackOf = (row: ReviewRow) => layers[row.item.id.replace('change:shop:', '')] ?? null
  // The stack's best layer is the 10-line top; the stack goes first, and its layers go bottom first.
  assert.deepEqual(ids(sortStory(rows, stackOf)), ['bottom', 'mid', 'top', 'lone'])
})

test('reviews still being prepared or not reviewed yet come after the rated ones, even when they press more', () => {
  const rows = rowsFor(
    [
      ready('later', { state: 'preparing', phase: 'reading', assessment: undefined, lines: 1 }),
      ready('rated', { lines: 900 }),
      ready('unrated', { assessment: undefined, lines: 1 }),
    ],
    { later: 'P0' },
  )
  assert.deepEqual(ids(sortStory(rows)), ['rated', 'later', 'unrated'])
})

test('the offer counts every review waiting on the user: ready, running and waiting its turn', () => {
  const items = [...Array.from({ length: 7 }, (_, n) => ready(`r${n}`)), ...Array.from({ length: 3 }, (_, n) => ready(`p${n}`, { state: 'preparing', phase: 'reading', assessment: undefined }))]
  const groups = groupReviews({ reviews: items })
  const waiting = waitingRows(groups, [])
  assert.equal(waiting.length, 10)
  assert.equal(offersStory(waiting), true)
  assert.equal(offersStory(waiting.slice(1)), false)
})

test('the story walks the queue, skips a review that is gone, and ends after the last', () => {
  const story = startStory(['a', 'b', 'c', 'd'])!
  assert.equal(storyPlace(story), '1 of 4')
  const second = advanceStory(story, () => false)!
  assert.deepEqual([second.at, storyPlace(second)], [1, '2 of 4'])
  const fourth = advanceStory(second, (id) => id === 'c')!
  assert.equal(storyPlace(fourth), '4 of 4')
  assert.equal(advanceStory(fourth, () => false), null)
  assert.equal(advanceStory(second, () => true), null)
  assert.equal(startStory([]), null)
})
