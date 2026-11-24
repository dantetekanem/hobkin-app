import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Grade } from '#shared/protocol/work.ts'
import type { AssessmentSummary } from '#shared/review/assessment.ts'
import type { ReviewListItem } from '#shared/review/status.ts'
import { rowsOf, type ReviewOrder, type ReviewRow } from '../src/features/work/ai-reviews.ts'
import { orderRows, placedRows, projectsOf, setKeyOf, stateNews, stateWords } from '../src/features/work/review-list.ts'

const HEAD = 'f3a9c1e7'.padEnd(40, '0')
const at = (minutesAgo: number) => new Date(Date.parse('2026-11-24T12:00:00Z') - minutesAgo * 60_000).toISOString()
const summary = (over: Partial<AssessmentSummary> = {}): AssessmentSummary => ({ level: 'safe', critical: false, needsYou: 0, worthALook: 0, safe: 1, storyBy: 'model', at: at(0), ...over })
const item = (name: string, over: Partial<ReviewListItem> = {}): ReviewListItem => ({
  id: `change:shop:${name}`,
  kind: 'change',
  title: name,
  project: 'shop',
  head: HEAD,
  state: 'ready',
  phase: null,
  error: null,
  updatedAt: at(0),
  assessment: { state: 'ready', head: HEAD, summary: summary() },
  ...over,
})
const rows = (reviews: ReviewListItem[], grades: Record<string, Grade> = {}) => rowsOf({ reviews }, (review) => grades[review.id.replace('change:shop:', '')] ?? null)
const names = (list: readonly ReviewRow[]) => list.map((row) => row.item.id.replace(/^[a-z]+:[^:]+:/, ''))
const order = (list: ReviewRow[], by: ReviewOrder) => names(orderRows(list, by))

test('a row says its own state in the same words: reviewing with its percent, waiting with how many are ahead, failed, and not rated', () => {
  const [running, preparing, waits, queued, failed, ready] = rowsOf({
    reviews: [
      item('a', { assessment: { state: 'running', head: HEAD, percent: 47.6, startedAt: at(2) } }),
      item('b', { state: 'preparing', phase: 'reading' }),
      item('c', { state: 'idle', waiting: true, assessment: undefined, turn: { ahead: 3, why: 'Waits its turn: 3 ahead in shop.' } }),
      item('d', { assessment: { state: 'queued', head: HEAD } }),
      item('e', { state: 'failed', assessment: undefined, error: 'gh is not signed in' }),
      item('f'),
    ],
  }).toSorted((x, y) => x.item.id.localeCompare(y.item.id))

  assert.deepEqual([running, preparing, waits, queued, failed, ready].map((row) => stateWords(row!.state)), ['Reviewing · 48%', 'Reviewing', 'Waits its turn · 3 ahead', 'Waits its turn', 'Review failed', 'Not rated'])
  assert.equal(stateNews(ready!.state), null)
  assert.equal(stateNews(running!.state), 'Reviewing · 48%')
})

test('easiest first is the story order: a merge that failed on top, what waits on the user in the story order, reviews that stopped last', () => {
  const list = rows(
    [
      item('big', { lines: 400 }),
      item('small', { lines: 20 }),
      item('stopped', { state: 'failed', assessment: undefined, error: 'no' }),
      item('unmerged', { lines: 900, mergeAsked: { at: at(1), state: 'failed', why: 'It moved.' } }),
      item('p0', { lines: 300 }),
    ],
    { p0: 'P0', big: 'P2', small: 'P2' },
  )
  assert.deepEqual(order(list, 'easiest'), ['unmerged', 'p0', 'small', 'big', 'stopped'])
})

test('priority puts the most pressing first and, of two alike, the one that waited longer; no priority last', () => {
  const list = rows([item('none', { updatedAt: at(1), assessment: { state: 'ready', head: HEAD, summary: summary({ at: at(1) }) } }), item('new', { updatedAt: at(2), assessment: { state: 'ready', head: HEAD, summary: summary({ at: at(2) }) } }), item('old', { updatedAt: at(9), assessment: { state: 'ready', head: HEAD, summary: summary({ at: at(9) }) } })], { new: 'P1', old: 'P1' })
  assert.deepEqual(order(list, 'priority'), ['old', 'new', 'none'])
})

test('newest, oldest and smallest', () => {
  const at3 = item('c', { lines: 5, assessment: { state: 'ready', head: HEAD, summary: summary({ at: at(3) }) } })
  const at1 = item('a', { lines: 500, assessment: { state: 'ready', head: HEAD, summary: summary({ at: at(1) }) } })
  const at2 = item('b', { assessment: { state: 'ready', head: HEAD, summary: summary({ at: at(2) }) } })
  const list = rows([at3, at1, at2])
  assert.deepEqual(order(list, 'newest'), ['a', 'b', 'c'])
  assert.deepEqual(order(list, 'oldest'), ['c', 'b', 'a'])
  assert.deepEqual(order(list, 'smallest'), ['c', 'a', 'b'], 'a review with no lines comes last')
})

test('the projects are cut from the ordered rows, in the order of their first row, each with its count', () => {
  const list = rows([item('a', { project: 'shop' }), item('b', { project: 'docs' }), item('c', { project: 'shop' })])
  const ordered = orderRows(list, 'oldest')
  assert.deepEqual(projectsOf(ordered).map(({ project, rows: own }) => [project, own.map((row) => row.item.title)]), [
    ['shop', ['a', 'c']],
    ['docs', ['b']],
  ])
})

test("a row's place holds while its facts change, and the set key changes only when a row comes or goes", () => {
  const before = rows([item('a'), item('b')])
  const ids = names(orderRows(before, 'oldest'))
  const later = rows([item('a', { state: 'preparing', assessment: undefined }), item('b', { updatedAt: at(-30) })])

  assert.equal(setKeyOf(before), setKeyOf(later), 'the same rows')
  assert.deepEqual(names(placedRows(ids.map((id) => `change:shop:${id}`), later)), ids, 'in the place they held')
  assert.equal(placedRows(['change:shop:a'], later)[0]!.state.kind, 'reviewing', 'with their newest facts')
  assert.notEqual(setKeyOf(rows([item('a'), item('b'), item('c')])), setKeyOf(before))
})
