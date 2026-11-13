import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STOP_ARMED_MS, stopKey } from '../src/features/chat/stop-key.ts'

test('one Escape never stops a run: the first asks, and only a second one soon after stops', () => {
  const first = stopKey(null, 1_000)
  assert.deepEqual(first, { stop: false, armedAt: 1_000 }, 'the first press only arms it')
  assert.deepEqual(stopKey(first.armedAt, 1_000 + STOP_ARMED_MS), { stop: true, armedAt: null }, 'a second press in time stops')
})

test('a second Escape that comes too late asks again', () => {
  assert.deepEqual(stopKey(1_000, 1_001 + STOP_ARMED_MS), { stop: false, armedAt: 1_001 + STOP_ARMED_MS })
})
