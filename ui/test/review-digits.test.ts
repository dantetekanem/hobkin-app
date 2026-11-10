import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commitDigits, DIGIT_WINDOW, NO_DIGITS, pressDigit, type DigitBuffer } from '../src/features/review/story/digits.ts'

/** Types digits at the given times and says where each press led: a step (1-based), a wait, or nothing. */
function type(total: number, presses: [digit: string, at: number][]) {
  let buffer: DigitBuffer = NO_DIGITS
  return presses.map(([digit, at]) => {
    const result = pressDigit(buffer, digit, at, total)
    buffer = result.buffer
    return result.jump != null ? `step ${result.jump + 1}` : result.wait != null ? `wait ${result.buffer.digits}` : 'nothing'
  })
}

test('one digit is one step, and 0 is step 10', () => {
  // In a story of nine steps, no digit can grow into another step, so each one jumps at once.
  assert.deepEqual(type(9, [['1', 0]]), ['step 1'])
  assert.deepEqual(type(9, [['9', 0]]), ['step 9'])
  // 0 is step 10. In a story of fewer steps it is the last one.
  assert.deepEqual(type(15, [['0', 0]]), ['step 10'])
  assert.deepEqual(type(7, [['0', 0]]), ['step 7'])
  // A digit past the end of a short story is its last step.
  assert.deepEqual(type(5, [['8', 0]]), ['step 5'])
})

test('two digits typed quickly make one number', () => {
  // 1 could still become 10 to 15, so it waits. The 2 that follows cannot grow, so 12 is taken at once.
  assert.deepEqual(type(15, [['1', 0], ['2', 200]]), ['wait 1', 'step 12'])
  assert.deepEqual(type(15, [['1', 0], ['0', 300]]), ['wait 1', 'step 10'])
  assert.deepEqual(type(49, [['4', 0], ['9', 500]]), ['wait 4', 'step 49'])
  // 2 could only become 20 or more, which a story of 15 does not have, so it is taken at once.
  assert.deepEqual(type(15, [['2', 0]]), ['step 2'])
  assert.deepEqual(type(49, [['5', 0]]), ['step 5'])
  // A number past the end of the story is its last step.
  assert.deepEqual(type(15, [['1', 0], ['9', 100]]), ['wait 1', 'step 15'])
})

test('a digit after the window starts a new number', () => {
  assert.deepEqual(type(15, [['1', 0], ['2', DIGIT_WINDOW + 1]]), ['wait 1', 'step 2'])
  assert.equal(DIGIT_WINDOW, 600)
})

test('when the window closes, the number typed so far is taken', () => {
  const waiting = pressDigit(NO_DIGITS, '1', 0, 15)
  assert.deepEqual([waiting.jump, waiting.wait, waiting.buffer.digits], [null, DIGIT_WINDOW, '1'])

  const committed = commitDigits(waiting.buffer, 15)
  assert.deepEqual([committed.jump, committed.buffer], [0, NO_DIGITS])
  assert.deepEqual(commitDigits(NO_DIGITS, 15), { buffer: NO_DIGITS, jump: null })

  // A story with no steps has nothing to jump to.
  assert.deepEqual(pressDigit(NO_DIGITS, '3', 0, 0), { buffer: NO_DIGITS, jump: null, wait: null })
  // Anything but a digit is ignored.
  assert.deepEqual(pressDigit(NO_DIGITS, 'x', 0, 15), { buffer: NO_DIGITS, jump: null, wait: null })
})
