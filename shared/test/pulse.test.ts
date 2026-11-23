import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAIN_PULSE, pulseLine, pulsesOf, type RunPulse } from '#shared/protocol/pulse.ts'

const STARTED = Date.parse('2026-11-23T10:00:00Z')
const SECOND = 1000
const MINUTE = 60 * SECOND

const pulse = (fields: Partial<RunPulse> = {}): RunPulse => ({ startedAt: STARTED, lastTokenAt: STARTED, phase: 'working', direction: 'up', tokens: 0, ...fields })

test("the line reads as the user's Pi extension writes it: the phase, the time since the run began, the arrow and the count", () => {
  const now = STARTED + 7 * MINUTE + 7 * SECOND
  const line = pulseLine(pulse({ lastTokenAt: now - SECOND, direction: 'down', tokens: 30_000 }), now)
  assert.deepEqual(line, { words: 'Working… (7m 7s · ↓ 30.0k tokens)', notice: null, tone: 'plain' })
})

test('thinking says so, a request on its way points up, and the time and the count take the shape their size needs', () => {
  const read = (fields: Partial<RunPulse>, elapsedMs: number) => pulseLine(pulse({ ...fields, lastTokenAt: STARTED + elapsedMs }), STARTED + elapsedMs).words
  assert.equal(read({ phase: 'thinking', direction: 'up', tokens: 812 }, 7 * SECOND), 'Thinking… (7s · ↑ 812 tokens)')
  assert.equal(read({ tokens: 999 }, 999), 'Working… (0s · ↑ 999 tokens)', 'a part second is not counted yet')
  assert.equal(read({ tokens: 1_000 }, MINUTE), 'Working… (1m 0s · ↑ 1.0k tokens)')
  assert.equal(read({ direction: 'down', tokens: 1_234_567 }, 3_723 * SECOND), 'Working… (1h 2m 3s · ↓ 1.2m tokens)')
})

test('a run that began after the window read its clock reads no time yet, never less, and a count never reads below none', () => {
  assert.equal(pulseLine(pulse({ startedAt: STARTED + 5 * SECOND, tokens: -3 }), STARTED).words, 'Working… (0s · ↑ 0 tokens)')
})

test('quiet past one and three minutes is a warning, past five it is trouble, and a token that moves takes the notice away', () => {
  const quietFor = (ms: number) => {
    const { notice, tone } = pulseLine(pulse({ lastTokenAt: STARTED }), STARTED + ms)
    return { notice, tone }
  }
  assert.deepEqual(quietFor(MINUTE), { notice: null, tone: 'plain' }, 'one minute exactly is not over one minute')
  assert.deepEqual(quietFor(MINUTE + 1), { notice: 'agent is taking a while...', tone: 'warn' })
  assert.deepEqual(quietFor(3 * MINUTE), { notice: 'agent is taking a while...', tone: 'warn' })
  assert.deepEqual(quietFor(3 * MINUTE + 1), { notice: 'agent is probably idle...', tone: 'warn' })
  assert.deepEqual(quietFor(5 * MINUTE), { notice: 'agent is probably idle...', tone: 'warn' })
  assert.deepEqual(quietFor(5 * MINUTE + 1), { notice: 'agent is idle', tone: 'bad' })

  const now = STARTED + 10 * MINUTE
  assert.deepEqual(pulseLine(pulse({ lastTokenAt: now - SECOND }), now).notice, null, 'quiet counts from the last token, not from the start')
})

test("a snapshot's pulses are read by run id with the main turn's under its own key, and a snapshot without any reads none", () => {
  const main = pulse({ phase: 'thinking' })
  const run = pulse({ direction: 'down', tokens: 40 })
  const pulses = { [MAIN_PULSE]: main, 'run-1': run }
  assert.equal(MAIN_PULSE, '#main')
  assert.equal(pulsesOf({ pulses }), pulses, 'the same object, so a reader of one snapshot keeps one pulse')
  assert.equal(pulsesOf({ pulses })['run-1'], run)

  for (const snapshot of [{}, { pulses: undefined }, { pulses: null }, { pulses: 'busy' }, { pulses: [main] }]) {
    assert.deepEqual(pulsesOf(snapshot), {}, JSON.stringify(snapshot))
  }
  assert.equal(pulsesOf({}), pulsesOf({ pulses: null }), 'no pulses is one empty object, so a selector that reads it holds still')
})
