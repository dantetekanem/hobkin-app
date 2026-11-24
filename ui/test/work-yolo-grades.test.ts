import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChangeRating } from '#shared/review/status.ts'
import { SAMPLE_RATINGS, ratingCell } from '../src/features/work/yolo-grades.ts'

const numbers = { rate: '8.4', other: null, at: '4f2a9c1', numbers: ['9', '9', '8', '8', '9'].map((value) => ({ word: 'x', value })) } as never

test('a change says one of rated, rating now, waits its turn, rating again or not rated after N tries, and never no rate yet', () => {
  const say = (rating: ChangeRating | undefined, nums = null as never) => ratingCell(rating, nums).text
  assert.equal(say({ state: 'rated', text: 'Rated at 4f2a9c1: 8.4.', rate: 8.4, head: '4f2a9c1' }, numbers), '8.4 · 9 9 8 8 9')
  assert.equal(say({ state: 'rated', text: 'Rated.', rate: 8.4 }), '8.4')
  assert.equal(say({ state: 'rating', text: '' }), 'Rating now')
  assert.equal(say({ state: 'waits', text: '', ahead: 3 }), 'Waits its turn: 3 ahead')
  assert.equal(say({ state: 'waits', text: '', ahead: 0 }), 'Waits its turn: next')
  assert.equal(say({ state: 'again', text: '', tries: 2, of: 3 }), 'Rating again, try 2 of 3')
  assert.equal(say({ state: 'again', text: '' }), 'Rating again')
  assert.equal(say({ state: 'not-rated', text: '', tries: 3 }), 'Not rated after 3 tries')
  assert.equal(say({ state: 'not-rated', text: '', tries: 1 }), 'Not rated after 1 try')
  assert.equal(say({ state: 'nothing', text: '' }), 'Nothing to rate')
  for (const rating of Object.values(SAMPLE_RATINGS)) assert.doesNotMatch(say(rating), /no rate|^–$|^$/i)
})

test('the why of a change that is not rated is in its tooltip, and the cell is marked bad', () => {
  const cell = ratingCell({ state: 'not-rated', text: 'Not rated after 3 tries: the answer had no score for rollback.', tries: 3 }, null)
  assert.deepEqual([cell.bad, cell.tip], [true, 'Not rated after 3 tries: the answer had no score for rollback.'])
})

test('an older rating is marked older with its commit, beside the state the change is in now', () => {
  const cell = ratingCell({ state: 'rating', text: 'Rating now.', older: { head: '3b9d21c0000000', rate: 8.2, text: 'An older rating, 8.2 at 3b9d21c.' } }, null)
  assert.deepEqual([cell.text, cell.older], ['Rating now', 'older 8.2 at 3b9d21c'])
  assert.match(cell.tip, /older rating/i)
})

test('a host that sends no rating still gets words: the review\'s numbers when it has them, else that it does not report', () => {
  assert.equal(ratingCell(undefined, numbers).text, '8.4 · 9 9 8 8 9')
  assert.equal(ratingCell(undefined, null).text, 'Rating not reported')
})
