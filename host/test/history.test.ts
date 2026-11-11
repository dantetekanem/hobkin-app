import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { HistoryConversation, HistoryEntry } from '#shared/commands/registry.ts'
import { History } from '../src/history.ts'
import { afterTest, Client, hostFor, temporaryDirectory } from './support.ts'

/** Every file in a folder, by name, with what it holds and when it last changed. */
const filesIn = (folder: string) =>
  Object.fromEntries(readdirSync(folder).map((name) => [name, `${createHash('sha256').update(readFileSync(join(folder, name))).digest('hex')} ${statSync(join(folder, name)).mtimeMs}`]))
const said = ({ messages }: HistoryConversation) => messages.map(({ role, text }) => `${role}: ${text}`)

test('lists earlier main sessions', async (t) => {
  const host = await hostFor(t, { scripted: { reply: ({ index }) => (index === 0 ? { text: '**First** answer', thinking: 'Private reasoning' } : { text: 'Second answer' }) } })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.live()
  const answered = (text: string) => client.until((now) => now.messages.some(({ content }) => content === text) && now.snapshot.busy === false, text)

  await client.run('conversation.send', { text: 'Plan the trip\nwith the details' })
  await answered('**First** answer')
  // hobkin's own /reset starts a new conversation file, and its /clear hides what Chat shows.
  await client.run('slash.run', { name: '/reset' })
  await client.run('conversation.send', { text: 'After the reset' })
  await answered('Second answer')
  await client.run('slash.run', { name: '/clear' })

  const sessions = join(host.root, 'sessions')
  const before = filesIn(sessions)
  const { conversations } = await client.run<{ conversations: HistoryEntry[] }>('history.list')
  assert.deepEqual(
    conversations.map(({ title, messages, current }) => ({ title, messages, current })),
    [
      { title: 'After the reset', messages: 2, current: true },
      { title: 'Plan the trip', messages: 2, current: false },
    ],
  )

  const earlier = await client.run<HistoryConversation>('history.open', { id: conversations[1]!.id })
  assert.deepEqual(said(earlier), ['user: Plan the trip\nwith the details', 'assistant: **First** answer'])
  assert.doesNotMatch(JSON.stringify(earlier), /Private reasoning/)
  // What /clear hid is still in the conversation, and History shows it.
  assert.deepEqual(said(await client.run<HistoryConversation>('history.open', { id: conversations[0]!.id })), ['user: After the reset', 'assistant: Second answer'])
  assert.deepEqual(filesIn(sessions), before)

  const outside = await client.command('history.open', { id: '../config.json' })
  assert.equal(!outside.ok && outside.error.code, 'invalid-arguments')
})

test("reads only hobkin's main session files, within its bounds", async (t) => {
  const home = temporaryDirectory(t)
  const sessions = join(home, 'sessions')
  mkdirSync(sessions)
  let entries = 0
  const conversation = (at: number, steps: [role: string, content: unknown, parent?: string][]) => {
    let parentId: string | null = null
    const lines = [{ type: 'session', version: 3, id: `s${at}`, timestamp: new Date(at).toISOString(), cwd: home }]
    for (const [role, content, parent] of steps) {
      const id = `e${++entries}`
      lines.push({ type: 'message', id, parentId: parent ?? parentId, timestamp: new Date(at).toISOString(), message: { role, content, timestamp: (at += 1000) } } as never)
      parentId = id
    }
    return lines.map((line) => JSON.stringify(line)).join('\n') + '\n'
  }
  const A = 'main-11111111-1111-4111-8111-111111111111.jsonl'
  const B = 'main-33333333-3333-4333-8333-333333333333.jsonl'
  const pairs = [1, 2, 3, 4, 5].flatMap((n): [string, string][] => [['user', `Question ${n}`], ['assistant', `Answer ${n}`]])
  writeFileSync(
    join(sessions, A),
    conversation(Date.UTC(2026, 10, 9), [
      ['user', '<hobkin-work>\n{"queued":1}\n</hobkin-work>\n\nWhat is *new*?\nMore words'],
      ['assistant', [{ type: 'text', text: 'Abandoned branch' }]],
      ['assistant', [{ type: 'thinking', thinking: 'hidden reasoning' }, { type: 'text', text: 'Two **things**.' }, { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: '/secret' } }], 'e1'],
      ['toolResult', [{ type: 'text', text: 'tool output' }]],
      ['user', '<hobkin-wake>\n{}\n</hobkin-wake>'],
      ...pairs,
    ]),
  )
  const limit = statSync(join(sessions, A)).size
  writeFileSync(join(sessions, B), conversation(Date.UTC(2026, 10, 1), [['user', 'Big start'], ['user', 'y'.repeat(limit)], ['user', 'Never read']]))
  writeFileSync(join(sessions, 'notes.jsonl'), conversation(Date.UTC(2026, 10, 10), [['user', 'Not a main session']]))
  writeFileSync(join(sessions, 'main.jsonl'), '{"type":"message"}\n')
  writeFileSync(join(home, 'elsewhere.jsonl'), conversation(Date.UTC(2026, 10, 10), [['user', 'Through a link']]))
  symlinkSync(join(home, 'elsewhere.jsonl'), join(sessions, 'main-22222222-2222-4222-8222-222222222222.jsonl'))
  const before = filesIn(sessions)

  const history = new History(home, () => join(sessions, A), { files: 10, bytes: limit, messages: 11 })
  const { conversations } = await history.list()
  assert.deepEqual(
    conversations.map(({ id, title, messages, current, cut }) => ({ id, title, messages, current, cut })),
    [
      { id: A, title: 'What is *new*?', messages: 12, current: true, cut: false },
      { id: B, title: 'Big start', messages: 1, current: false, cut: true },
    ],
  )

  const opened = await history.open(A)
  assert.equal(opened.earlier, 1)
  assert.deepEqual(said(opened).slice(0, 3), ['assistant: Two **things**.', 'user: Question 1', 'assistant: Answer 1'])
  assert.equal(opened.messages.length, 11)
  assert.doesNotMatch(JSON.stringify([conversations, opened]), /hidden reasoning|\/secret|tool output|hobkin-wake|Abandoned/)
  assert.deepEqual(said(await history.open(B)), ['user: Big start'])

  for (const id of ['notes.jsonl', 'main-22222222-2222-4222-8222-222222222222.jsonl', 'main-44444444-4444-4444-8444-444444444444.jsonl']) {
    await assert.rejects(history.open(id), /not one of hobkin's conversations/)
  }
  assert.deepEqual(filesIn(sessions), before)
})
