import assert from 'node:assert/strict'
import { test } from 'node:test'
import { goBack, goForward, HISTORY_LIMIT, NO_HISTORY, recordFocus, type FocusEntry } from '../src/features/review/story/history.ts'

const at = (step: number, detour: string | null = null, whole = false): FocusEntry => ({ step, detour, whole })

test('back and forward walk the places the reviewer jumped to', () => {
  // Step 7, then a node found by name, then a node along a wire.
  let history = recordFocus(NO_HISTORY, at(6), at(6, 'u4'))
  history = recordFocus(history, at(6, 'u4'), at(6, 'u2'))

  const first = goBack(history, at(6, 'u2'))!
  assert.deepEqual(first.entry, at(6, 'u4'))
  const second = goBack(first.history, first.entry)!
  assert.deepEqual(second.entry, at(6))
  assert.equal(goBack(second.history, second.entry), null, 'nothing before the first place')

  const ahead = goForward(second.history, second.entry)!
  assert.deepEqual(ahead.entry, at(6, 'u4'))
  const ahead2 = goForward(ahead.history, ahead.entry)!
  assert.deepEqual(ahead2.entry, at(6, 'u2'))
  assert.equal(goForward(ahead2.history, ahead2.entry), null, 'nothing after the last place')
})

test('a new jump after going back drops what was ahead', () => {
  let history = recordFocus(NO_HISTORY, at(0), at(4))
  history = recordFocus(history, at(4), at(9))
  const back = goBack(history, at(9))!
  history = recordFocus(back.history, back.entry, at(4, 'c1'))

  assert.equal(goForward(history, at(4, 'c1')), null)
  assert.deepEqual(goBack(history, at(4, 'c1'))!.entry, at(4))
})

test('staying in place is not a step of history, and history is kept short', () => {
  assert.deepEqual(recordFocus(NO_HISTORY, at(3), at(3)), NO_HISTORY)

  let history = NO_HISTORY
  for (let index = 0; index < HISTORY_LIMIT + 20; index += 1) history = recordFocus(history, at(index), at(index + 1))
  assert.equal(history.back.length, HISTORY_LIMIT)
  assert.deepEqual(history.back.at(-1), at(HISTORY_LIMIT + 19), 'the most recent places are the ones kept')
})
