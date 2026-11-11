import assert from 'node:assert/strict'
import test from 'node:test'
import { explainRefusal, RESTART_NEEDED } from '../src/lib/host/refusal.ts'

test('a host older than the window refuses a known command by name, and the window says a restart fixes it', () => {
  const refused = explainRefusal(new Error('There is no command named "routine.run".'))
  assert.ok(refused instanceof Error)
  assert.equal(refused.message, RESTART_NEEDED)
})

test("any other refusal keeps hobkin's own words", () => {
  const busy = new Error('Routine is already running.')
  assert.equal(explainRefusal(busy), busy)
})
