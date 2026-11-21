import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cutOf, cutWords, sizeOf } from '../src/features/agent-activity/cut-output.ts'

test('an output the feed cut says how much there is in all, and what a press does', () => {
  assert.equal(cutOf({ id: 'tool:1', kind: 'tool', output: 'head\n…\ntail' }), null)
  assert.equal(cutOf({ id: 'tool:1', kind: 'tool', output: 'head\n…\ntail', outputLength: 49_300 }), 49_300)
  assert.equal(sizeOf(9_830), '9.6 KB')
  assert.equal(sizeOf(49_300), '48 KB')
  assert.equal(sizeOf(3_400_000), '3.2 MB')
  assert.equal(cutWords(49_300, 'cut'), 'Show all 48 KB')
  assert.equal(cutWords(49_300, 'reading'), 'Reading all 48 KB…')
  // Without a saved session to read it from, the kept ends stay, and the size is said.
  assert.equal(cutWords(49_300, 'unsaved'), '48 KB in all')
})
