import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { checkArguments, type CommandName } from '#shared/commands/registry.ts'
import { discussesKey, discussionOf, discussItem } from '../src/features/actions/discuss.ts'
import { hostRows } from '../src/features/actions/host.ts'
import { waiting, type WaitingRow } from '../src/features/actions/items.ts'
import { sampleItems } from '../src/features/actions/sample.ts'
import { useActionItems } from '../src/features/actions/store.ts'
import { emptyQueue } from '../src/features/questions/queue.ts'
import { replyToReport, useReportReply } from '../src/features/reports/reply.ts'
import { HostConnection } from '../src/lib/host/connection.ts'
import { hostStore } from '../src/lib/host/client.ts'
import { initialHostState } from '../src/lib/host/state.ts'

const aliasHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('@/')) return nextResolve(specifier, context)
    return nextResolve(pathToFileURL(resolve(import.meta.dirname, '../src', specifier.slice(2))).href, context)
  },
})
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } } })
after(() => {
  Reflect.deleteProperty(globalThis, 'window')
  aliasHooks.deregister()
})
const { useChat } = await import('../src/features/chat/chat-store.ts')
const { emptyDraft } = await import('../src/features/chat/draft.ts')

const decision = (id: string, answerTo: Record<string, unknown> | null, rest: Record<string, unknown> = {}) => ({
  id,
  key: null,
  from: 'hobkin',
  question: 'Keep the newsletter?',
  tldr: 'Keep the newsletter?',
  choices: [
    { value: 'yes', label: 'Keep it' },
    { value: 'no', label: 'Unsubscribe' },
  ],
  answerTo,
  recommended: 'no',
  why: 'Nobody opened it in 9 weeks.',
  changed: null,
  at: '2026-11-09T08:00:00.000Z',
  ...rest,
})

const decided = (answerTo: Record<string, unknown> | null) => hostRows({ decisions: [decision('d1', answerTo)], waiting: null })[0]!
const lines = (row: WaitingRow) => discussionOf(row).body!.split('\n')
const has = (row: WaitingRow, ...expected: string[]) => {
  const said = lines(row)
  for (const line of expected) assert.ok(said.includes(line), `"${line}" is in:\n${said.join('\n')}`)
}

test("every kind of action item is discussed by its own identity, and where it came from, as hobkin files it", () => {
  // hobkin's decisions, by what they answer to (`answerTo.kind` in its src/cli/decisions.mjs).
  has(decided({ kind: 'routine', id: 'inbox-sweep' }), 'Kind: Routine', 'Decision: d1 (routine)', 'Routine: inbox-sweep')
  has(decided({ kind: 'action', id: 'renewals' }), 'Decision: d1 (action)', 'Routine: renewals')
  has(decided({ kind: 'routines', subject: 'routine', id: 'reading-list', file: 'reading-list.md' }), 'Decision: d1 (routines)', 'Routine: reading-list', 'File: reading-list.md')
  has(decided({ kind: 'routines', subject: 'template', id: 'weekly' }), 'Template: weekly')
  has(decided({ kind: 'work', slug: 'storefront', item: '3fa9c1' }), 'Kind: Work needs attention', 'Decision: d1 (work)', 'Project: storefront', 'Work item: 3fa9c1')
  has(decided({ kind: 'yours', slug: 'billing-api', item: 'b72e10' }), 'Kind: Only you can do this', 'Project: billing-api', 'Work item: b72e10')
  has(
    decided({ kind: 'merge', slug: 'orchard', item: '5e77a1', head: '9b41f02' }),
    'Kind: Finished branch',
    'Decision: d1 (merge)',
    'Project: orchard',
    'Work item: 5e77a1',
    'Branch head: 9b41f02',
    'Review: change:orchard:5e77a1',
  )
  has(decided({ kind: 'pickup', keys: ['billing-api:retry-webhooks', 'storefront:lazy-images'] }), 'Kind: What to start', 'Queue: billing-api:retry-webhooks, storefront:lazy-images')
  // Kinds the screen calls a question keep hobkin's own record of where the answer goes.
  has(decided({ kind: 'reminder', id: 'dentist' }), 'Kind: Question', 'Decision: d1 (reminder)', 'Filed for: {"kind":"reminder","id":"dentist"}')
  has(decided({ kind: 'chat' }), 'Decision: d1 (chat)')
  has(decided(null), 'Decision: d1')

  // What hobkin keeps in its waiting list, answered here.
  const [learning] = hostRows({ waiting: { proposals: [{ id: 'a1b2c3', title: 'Keep reports short', question: 'Keep reports short?', scope: 'morning-recap' }] } })
  has(learning!, 'Learning proposal: a1b2c3', 'Question: Keep reports short?')
  const [project] = hostRows({ waiting: { asks: [{ id: 'p1', kind: 'proposal', slug: 'orchard', title: 'Take on orchard?' }] } })
  has(project!, 'Project proposal: orchard', 'Choices: Take it; Skip')
  const [step] = hostRows({ waiting: { yours: [{ slug: 'billing-api', item: 'b72e10', title: 'Rotate the webhook secret', attentionKind: 'personal' }] } })
  has(step!, 'Project: billing-api', 'Work item: b72e10')

  // What opens where it is handled, should it be listed.
  const [report] = hostRows({ waiting: { reports: [{ id: 'r2', title: 'Morning recap', next: 'Read the billing note.' }] } })
  has(report!, 'Report: r2', 'Detail: Read the billing note.')
  const [branch] = hostRows({ waiting: { branches: [{ slug: 'storefront', item: '3fa9c1', title: 'Fix the login loop' }] } })
  has(branch!, 'Waiting entry: waiting:branches:storefront:3fa9c1, handled in Work')

  // A sample has no record in hobkin, and a question put off from the sheet is known by the sheet's id.
  const sample = waiting(sampleItems, emptyQueue).find(({ id }) => id === 'decision-orchard-offer')!
  has(sample, 'Decision: decision-orchard-offer (merge)', 'Sample: this item is in this window only, and hobkin has no record of it.', 'Review: change:orchard:5e77a1')
  const putOff = { id: 'q7', from: 'Routine inbox-sweep', question: 'Which label?', choices: [{ value: 'a', label: 'Bills' }, { value: 'b', label: 'Receipts' }] }
  const [sheet] = waiting([], { ...emptyQueue, deferred: [putOff] })
  has(sheet!, 'Question put off from the question sheet: q7', 'From: Routine inbox-sweep', 'Choices: Bills; Receipts')
})

test('an item is discussed with everything its card says, and is told to stay open', () => {
  const row = hostRows({
    decisions: [
      decision('d1', { kind: 'routine', id: 'inbox-sweep' }, {
        from: 'Routine inbox-sweep',
        changed: 'It now comes twice a week.',
        links: [{ label: 'Inbox', url: 'https://mail.example.com/inbox' }],
        sure: 'medium',
        reversible: true,
        deadline: '2026-11-26T22:00:00.000Z',
      }),
    ],
    waiting: null,
  })[0]!
  const context = discussionOf(row)

  assert.deepEqual([context.id, context.title, context.kind], ['d1', 'Keep the newsletter?', 'item'])
  assert.match(lines(row)[0]!, /answers nothing/)
  has(
    row,
    'From: Routine inbox-sweep',
    'Question: Keep the newsletter?',
    "Choices: Unsubscribe (hobkin's pick, sure: medium); Keep it",
    'Can be undone: yes',
    "Takes hobkin's pick by itself at: 2026-11-26T22:00:00.000Z",
    'Why: Nobody opened it in 9 weeks.',
    'Changed: It now comes twice a week.',
    'Filed: 2026-11-09T08:00:00.000Z',
    'Inbox: https://mail.example.com/inbox',
  )
  assert.equal(checkArguments('conversation.send', { text: 'Why?', item: { id: context.id, title: context.title, body: context.body } }).ok, true)
})

test("a context longer than hobkin's command takes is cut to fit", () => {
  const long = 'A very long question. '.repeat(3000)
  const row = hostRows({ decisions: [decision('d1', null, { question: long, tldr: long })], waiting: null })[0]!
  const context = discussionOf(row)

  assert.equal(checkArguments('conversation.send', { text: 'Why?', item: { id: context.id, title: context.title, body: context.body } }).ok, true)
})

test('discussing an item keeps the words already written, sends nothing and answers nothing, and the next message carries it', async (t) => {
  const calls: { name: CommandName; args: unknown; resolve(value: unknown): void }[] = []
  t.mock.method(HostConnection.prototype, 'command', (name: CommandName, args: unknown) => new Promise((resolve) => calls.push({ name, args, resolve })))
  hostStore.setState({ ...initialHostState, link: 'open', home: '/isolated', owner: { state: 'live' as const, limits: { images: 4, imageBytes: 1_000_000 } } }, true)
  useChat.setState({ draft: { ...emptyDraft, text: 'Is it worth' }, problem: null })
  const row = decided({ kind: 'merge', slug: 'orchard', item: '5e77a1', head: '9b41f02' })
  // Going live asks for the slash commands. That is the chat's, not the item's.
  calls.length = 0

  discussItem(row)

  assert.equal(useChat.getState().draft.text, 'Is it worth', 'the words already written stay as they are')
  assert.deepEqual(useReportReply.getState().report, discussionOf(row), 'the item waits on the next message')
  assert.deepEqual(calls.map(({ name }) => name), [], 'nothing is sent, answered or merged')
  assert.deepEqual([useActionItems.getState().answering, useActionItems.getState().answeredHere], [[], []])

  useChat.getState().change({ type: 'typed', text: 'Is it worth merging today?' })
  const sending = useChat.getState().send()
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.name, 'conversation.send')
  assert.deepEqual(calls[0]!.args, { text: 'Is it worth merging today?', item: { id: 'd1', title: row.summary, body: discussionOf(row).body } })
  calls[0]!.resolve({ id: 'm1', queued: false })
  assert.equal(await sending, true)
  assert.equal(useReportReply.getState().report, null, 'it goes once')
  hostStore.setState(initialHostState, true)
})

test('r, or m as on Reports, discusses the item that has the keyboard, never while typing or with a modifier', () => {
  assert.equal(discussesKey({ key: 'r' }, false), true)
  assert.equal(discussesKey({ key: 'm' }, false), true)
  assert.equal(discussesKey({ key: 'r' }, true), false, 'typed in the answer field')
  assert.equal(discussesKey({ key: 'r', meta: true }, false), false, 'Command+R reloads')
  assert.equal(discussesKey({ key: 'R', shift: true }, false), false)
  assert.equal(discussesKey({ key: 'r', ctrl: true }, false), false)
  assert.equal(discussesKey({ key: 'r', alt: true }, false), false)
  assert.equal(discussesKey({ key: 'd' }, false), false)
})

test('a report of every kind is discussed by its own id, which hobkin looks up in its own list', () => {
  const sources = ['inbox-sweep', 'work.storefront.do', 'work.discover', 'work.session', 'session.claude', undefined]
  for (const scheduleId of sources) {
    replyToReport({ id: `r-${scheduleId}`, title: 'A report', body: 'Useful: one thing.', outcome: 'completed', ...(scheduleId ? { scheduleId } : {}) })
    assert.deepEqual(useReportReply.getState().report, { id: `r-${scheduleId}`, title: 'A report' })
  }
  useReportReply.getState().clear()
})
