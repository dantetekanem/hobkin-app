import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatMessage } from '#shared/protocol/snapshot.ts'
import { buildConversation, type NoticeEntry } from '../src/features/chat/conversation.ts'
import { createMemoryActions } from '../src/features/memory/actions.ts'
import { lineWords } from '../src/features/memory/line.ts'
import { createMemoryStore, type MemorySend } from '../src/features/memory/store.ts'

const NOW = Date.parse('2026-11-23T15:00:00Z')
const notices = (messages: ChatMessage[]) => buildConversation({ messages, now: NOW, timeZone: 'UTC' }).flatMap(({ entries }) => entries) as NoticeEntry[]

const REMEMBERED: ChatMessage = {
  id: 'notice:m1',
  role: 'notice',
  tone: 'quiet',
  content: 'Remembered from Claude Code: Lives in Lisbon; use Portuguese sites first',
  at: '2026-11-23T14:00:00Z',
  memory: { change: 'c-41', name: 'lives-in-lisbon', did: 'added' },
}

test('a line about a memory an agent changed carries what Undo and See need', () => {
  const [entry] = notices([REMEMBERED])
  assert.deepEqual(entry?.memory, { change: 'c-41', name: 'lives-in-lisbon', did: 'added' })
})

test("an older host's line, or one whose note is broken, shows as any other line, with no Undo", () => {
  const { memory: _none, ...older } = REMEMBERED
  const broken = { ...REMEMBERED, id: 'notice:m2', memory: { change: '', name: 'Not A Name' } } as unknown as ChatMessage
  for (const entry of notices([older, broken])) {
    assert.equal(entry.kind, 'notice')
    assert.equal('memory' in entry, false)
  }
})

test('two lines alike about two changes stay two lines, each with its own Undo', () => {
  const again = { ...REMEMBERED, id: 'notice:m3', memory: { change: 'c-42', name: 'lives-in-lisbon' } }
  assert.deepEqual(notices([REMEMBERED, again]).map((entry) => [entry.count, entry.memory?.change]), [[1, 'c-41'], [1, 'c-42']])
})

test("a line's Undo sends memory.undo once, and the line then says it was undone", async () => {
  const sent: unknown[] = []
  const send: MemorySend = async (name, args) => {
    sent.push([name, args])
    return { ok: true }
  }
  const store = createMemoryStore({ send })
  const actions = createMemoryActions(store, send)
  await Promise.all([actions.undoLine('c-41'), actions.undoLine('c-41')])
  await actions.undoLine('c-41')
  assert.deepEqual(sent, [['memory.undo', { change: 'c-41' }]])
  assert.equal(lineWords(store.getState().lines['c-41']), 'Undone.')
})

test("a line's Undo the host refuses says why, in its words", async () => {
  const send: MemorySend = async () => ({ ok: false, reason: 'It changed since. Edit it instead.' })
  const store = createMemoryStore({ send })
  await createMemoryActions(store, send).undoLine('c-41')
  assert.equal(lineWords(store.getState().lines['c-41']), 'Not undone: It changed since. Edit it instead.')
  assert.equal(lineWords(undefined), null)
  assert.equal(lineWords({ state: 'sending' }), 'Undoing…')
})
