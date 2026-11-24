import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toWire } from '../src/state-sync.ts'

// The quiet lines hobkin posts when an agent changes a memory (057-shared-memory), on their way to the window. Invented.
const NOTED = { id: 'notice:memory-1', role: 'notice', tone: 'quiet', content: 'Remembered from Claude Code: Lives in Lisbon', memory: { change: 'chg-1', name: 'lives-in-lisbon', did: 'added' } }
const PLAIN = { id: 'notice:2', role: 'notice', tone: 'quiet', content: 'Noted from Claude Code: the user lives in Lisbon' }

test("a quiet line's note about a memory reaches the window in its shape", () => {
  assert.deepEqual(toWire({ messages: [NOTED] }).messages, [NOTED])
  const [odd] = toWire({ messages: [{ ...NOTED, memory: { change: 'chg-1', name: 'lives-in-lisbon', did: 'moved', text: 'what the memory says' } }] }).messages
  assert.deepEqual(odd, { ...NOTED, memory: { change: 'chg-1', name: 'lives-in-lisbon' } }, 'only what the contract names goes, and a did it does not know is left out')
})

test('a note the window could not offer Undo by is left out, and the line shows as any other', () => {
  for (const memory of [null, 'chg-1', { change: 'chg-1' }, { change: 7, name: 'lives-in-lisbon' }, { change: 'chg-1', name: 'Not A Name' }]) {
    const [line] = toWire({ messages: [{ ...PLAIN, memory }] }).messages
    assert.deepEqual(line, PLAIN, JSON.stringify(memory))
  }
})

test('a runtime from before sends no note and no stamp, and every message goes as the same object', () => {
  const message = { id: 'm1', role: 'assistant', content: 'Hello' }
  const { values, messages } = toWire({ messages: [message, PLAIN], busy: false })
  assert.equal(messages[0], message)
  assert.equal(messages[1], PLAIN)
  assert.equal('memoriesStamp' in values, false)
})

test('the stamp of the memories reaches the snapshot as words, and one that is not is left out', () => {
  assert.equal(toWire({ messages: [], memoriesStamp: '2026-11-23T12:00:00.000Z:3' }).values.memoriesStamp, '2026-11-23T12:00:00.000Z:3')
  assert.equal(toWire({ messages: [], memoriesStamp: 1764000000000 }).values.memoriesStamp, '1764000000000')
  for (const stamp of [null, '', 'x'.repeat(129), { at: 1 }, Number.NaN]) {
    assert.equal('memoriesStamp' in toWire({ messages: [], memoriesStamp: stamp }).values, false, JSON.stringify(stamp))
  }
})
