import assert from 'node:assert/strict'
import { test } from 'node:test'
import { changeLine } from '../src/features/chat/change-line.ts'

test('a line that starts with /model or /effort is a change, with the one word it takes', () => {
  assert.deepEqual(changeLine('/model opus'), { model: 'opus' })
  assert.deepEqual(changeLine('  /model   anthropic/claude-opus-5 '), { model: 'anthropic/claude-opus-5' })
  assert.deepEqual(changeLine('/effort high'), { effort: 'high' })
  assert.deepEqual(changeLine('/effort xhigh'), { effort: 'xhigh' })
})

test('a change that says too little, too much or an unknown level says what to write', () => {
  assert.deepEqual(changeLine('/model'), { problem: 'Write /model and a model, such as /model opus.' })
  assert.deepEqual(changeLine('/model two words'), { problem: 'Write /model and a model, such as /model opus.' })
  assert.deepEqual(changeLine('/effort'), { problem: 'Write /effort and one of off, minimal, low, medium, high, xhigh, max.' })
  assert.deepEqual(changeLine('/effort very'), { problem: 'Write /effort and one of off, minimal, low, medium, high, xhigh, max.' })
})

test('words that are not slash lines stay messages', () => {
  for (const text of ['', 'hello', 'use /model opus', '/modeling', '/effortless now', '/feedback it flickers', '/model\nopus']) {
    assert.equal(changeLine(text), null, text)
  }
})
