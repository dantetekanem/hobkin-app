import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import type { HobkinConversation, HobkinSummary, HobkinTurn } from '#shared/protocol/hobkins.ts'
import { atOf } from '../src/features/agent-activity/steps.ts'
import { pageRows, pageTurns, withReceipts, type PageRow, type SendingNote, type SentNote } from '../src/features/hobkins/conversation.ts'

// Every state a durable hobkin's page passes through from Enter until the host has caught up, in the order the host
// sends them: the say's answer comes before the snapshot that shows the new turn, and the read comes after both.

const id = '0a1b2c3d'
const runOf = (n: number) => `hobkin:${id}:${n}`

const summary = (over: Partial<HobkinSummary>): HobkinSummary => ({
  id,
  title: 'A Quick Greeting',
  cwd: '/Users/someone',
  engine: { kind: 'tier', tier: 'mid' },
  state: 'waiting',
  turns: 2,
  run: null,
  last: { status: 'completed', said: 'Passed it along', at: '2026-11-13T12:02:00.000Z' },
  waiting: { since: '2026-11-13T12:02:00.000Z', seen: true },
  createdAt: '2026-11-13T12:00:00.000Z',
  ...over,
})

const turn = (n: number, asked: string, status: HobkinTurn['status'], reply: string | null = null): HobkinTurn => ({
  n,
  run: runOf(n),
  asked,
  askedAt: `2026-11-13T12:0${n}:00.000Z`,
  status,
  reply,
  error: null,
  endedAt: status === 'running' ? null : `2026-11-13T12:0${n}:30.000Z`,
})

const earlier = [turn(1, 'hey', 'completed', "Hey! What's up?"), turn(2, 'tell the main hobkin that i love him', 'completed', 'Passed it along.')]
const waiting = summary({})
const working = summary({ state: 'working', turns: 3, run: runOf(3), waiting: null })
const before: HobkinConversation = { hobkin: waiting, turns: earlier }
const said = (entryId: string, text: string): ActivityEntry => ({ id: `message:${entryId}`, kind: 'assistant', text })
const tool = (entryId: string): ActivityEntry => ({ id: `tool:${entryId}`, kind: 'tool', name: 'read', state: 'completed', input: '{"path":"a.ts"}', output: 'x' })

/** The activity of the turn in flight as the page reads it: each entry seen by the window at the time given. */
const activityOf = (entries: ActivityEntry[], seen: Record<string, number>) => ({ entries, seenAt: (entryId: string) => seen[entryId] })

const keys = (rows: readonly PageRow[]) => rows.map((row) => row.key)
const saidRow = (rows: readonly PageRow[], text: string) => rows.find((row) => row.kind === 'said' && row.text === text)

/** No key twice in a state, and every message the user sent stays, under one key, in every state after it first shows. */
function assertSteady(states: readonly (readonly PageRow[])[]) {
  for (const rows of states) assert.equal(new Set(keys(rows)).size, rows.length, `a key is used twice: ${keys(rows).join(', ')}`)
  states.forEach((rows, at) => {
    for (const row of rows) {
      if (row.kind !== 'said') continue
      for (const later of states.slice(at + 1)) {
        assert.ok(keys(later).includes(row.key), `"${row.text}" (${row.key}) left the page in a later state: ${keys(later).join(', ')}`)
      }
    }
  })
}

test('a message that starts a turn shows once, under one key, from Enter until the host has read it', () => {
  const sending: SendingNote = { text: 'das', at: 1000 }
  const sent: SentNote[] = [{ text: 'das', at: 1000, run: runOf(3), started: true }]
  const read: HobkinConversation = { hobkin: working, turns: [...earlier, turn(3, 'das', 'running')] }

  const states = [
    // Waiting, nothing on its way.
    pageRows(pageTurns(before, waiting, []), { sending: null, activity: null }),
    // Enter: the message is on its way.
    pageRows(pageTurns(before, waiting, []), { sending, activity: null }),
    // The say answers: it began turn 3. The snapshot still says the hobkin waits.
    pageRows(pageTurns(before, waiting, sent), { sending: null, activity: null }),
    // The snapshot: it works on turn 3, which no read has yet.
    pageRows(pageTurns(before, working, sent), { sending: null, activity: null }),
    // The read has turn 3.
    pageRows(pageTurns(read, working, sent), { sending: null, activity: null }),
    // Its first step arrives.
    pageRows(pageTurns(read, working, sent), { sending: null, activity: activityOf([said('a', 'Got it.')], { 'message:a': 1100 }) }),
  ]
  assertSteady(states)

  const [, onItsWay, answered, snapshot, readBack] = states
  assert.equal(saidRow(onItsWay!, 'das')?.key, saidRow(readBack!, 'das')?.key, 'the same row from Enter to the read')
  assert.deepEqual(keys(states[0]!), keys(onItsWay!).slice(0, states[0]!.length), 'the rows above stay as they were')
  // From the say's answer on, the turn is in flight: Thinking under the message, as in the screenshot.
  for (const rows of [answered!, snapshot!, readBack!]) assert.deepEqual(rows.slice(-2).map((row) => row.kind), ['said', 'thinking'])
})

test('a message added while a turn works lands where it showed, under one key', () => {
  const read: HobkinConversation = { hobkin: working, turns: [...earlier, turn(3, 'das', 'running')] }
  const opened: SentNote = { text: 'das', at: 1000, run: runOf(3), started: true }
  const steps = activityOf([tool('a')], { 'tool:a': 1100 })
  // A step the window sees after Enter but before the say answers comes after the message.
  const later = activityOf([tool('a'), said('b', 'Now the other one.')], { 'tool:a': 1100, 'message:b': 1250 })
  const sending: SendingNote = { text: 'also the README', at: 1200 }
  const added: SentNote = { text: 'also the README', at: 1200, run: runOf(3), started: false }

  const states = [
    pageRows(pageTurns(read, working, [opened]), { sending: null, activity: steps }),
    pageRows(pageTurns(read, working, [opened]), { sending, activity: steps }),
    pageRows(pageTurns(read, working, [opened]), { sending, activity: later }),
    pageRows(pageTurns(read, working, [opened, added]), { sending: null, activity: later }),
  ]
  assertSteady(states)

  const [first, onItsWay, stepAfter, answered] = states
  const at = (rows: readonly PageRow[]) => keys(rows).indexOf(saidRow(rows, 'also the README')!.key)
  assert.equal(at(onItsWay!), first!.length - 1, 'after the steps so far, above Thinking')
  assert.equal(at(answered!), at(stepAfter!), 'it does not move when the host answers')
  assert.equal(answered!.at(at(answered!) + 1)?.kind, 'step', 'the step seen after Enter is under it')
})

test('a turn that ends keeps its steps until a read has its answer, and the answer shows once', () => {
  const read: HobkinConversation = { hobkin: working, turns: [...earlier, turn(3, 'das', 'running')] }
  const ended = summary({ turns: 3, last: { status: 'completed', said: 'Done', at: '2026-11-13T12:03:30.000Z' } })
  const done: HobkinConversation = { hobkin: ended, turns: [...earlier, turn(3, 'das', 'completed', 'Done.')] }
  const sent: SentNote[] = [{ text: 'das', at: 1000, run: runOf(3), started: true }]
  // Its last step is a finished call, so while it is in flight it thinks.
  const activity = activityOf([said('b', 'On it.'), tool('a')], { 'message:b': 1100, 'tool:a': 1200 })

  const working3 = pageRows(pageTurns(read, working, sent), { sending: null, activity })
  assert.equal(working3.at(-1)?.kind, 'thinking')
  // The snapshot says it waits again; the read still has the turn running.
  const between = pageRows(pageTurns(read, ended, sent), { sending: null, activity })
  const answered = pageRows(pageTurns(done, ended, sent), { sending: null, activity: null })
  assertSteady([working3, between, answered])

  assert.deepEqual(keys(between), keys(working3).filter((key) => key !== 'working'), 'the same steps, and no Thinking once it is over')
  assert.ok(between.every((row) => row.kind !== 'answer' || row.turn.run !== runOf(3)), 'no answer before the read has it')
  const answer = answered.find((row) => row.kind === 'answer' && row.turn.run === runOf(3))
  assert.equal(answer?.kind === 'answer' ? answer.turn.reply : null, 'Done.')
  assert.ok(answered.every((row) => row.kind !== 'step'))
})

test('every row says when it happened: a message when it was asked or sent, a step when it began, an answer when it ended', () => {
  const read: HobkinConversation = { hobkin: working, turns: [...earlier, turn(3, 'das', 'running')] }
  const opened: SentNote = { text: 'das', at: 1000, run: runOf(3), started: true }
  const added: SentNote = { text: 'also the README', at: 1200, run: runOf(3), started: false }
  const steps = activityOf([{ ...tool('a'), at: 1100 }], { 'tool:a': 1100 })
  const rows = pageRows(pageTurns(read, working, [opened, added]), { sending: { text: 'and the tests', at: 1300 }, activity: steps })
  const when = (all: readonly PageRow[]) => all.map((row) => [row.kind, row.kind === 'step' ? atOf(row.step) : row.kind === 'thinking' ? null : row.at])
  assert.deepEqual(when(rows), [
    ['said', Date.parse('2026-11-13T12:01:00.000Z')],
    ['answer', Date.parse('2026-11-13T12:01:30.000Z')],
    ['said', Date.parse('2026-11-13T12:02:00.000Z')],
    ['answer', Date.parse('2026-11-13T12:02:30.000Z')],
    // hobkin's own time for the message, once a read has it.
    ['said', Date.parse('2026-11-13T12:03:00.000Z')],
    ['step', 1100],
    // What the user added, and what is on its way: when they pressed Enter.
    ['said', 1200],
    ['said', 1300],
    ['thinking', null],
  ])
  // Before a read has the turn, its message is timed by Enter too; a turn read while it still ran has no end yet.
  assert.deepEqual(when(pageRows(pageTurns(before, working, [opened]), { sending: null, activity: null })).slice(-2), [['said', 1000], ['thinking', null]])
  const odd: HobkinConversation = { hobkin: summary({ turns: 3 }), turns: [...earlier, turn(3, 'das', 'running')] }
  assert.deepEqual(when(pageRows(pageTurns(odd, summary({ turns: 3 }), []), { sending: null, activity: null })).at(-1), ['answer', null])
})

test('a read that has a turn running while the hobkin already waited says so', () => {
  // Not caught in flight: the read's own hobkin was waiting, so the page has no steps to keep and says what it has.
  const odd: HobkinConversation = { hobkin: summary({ turns: 3 }), turns: [...earlier, turn(3, 'das', 'running')] }
  const rows = pageRows(pageTurns(odd, summary({ turns: 3 }), []), { sending: null, activity: null })
  assert.deepEqual(rows.slice(-2).map((row) => row.kind), ['said', 'answer'])
  assert.ok(rows.every((row) => row.kind !== 'thinking'))
})

/** Each message the user's page shows, with its mark: null for words another hobkin sent. */
const marks = (rows: readonly PageRow[]) => rows.flatMap((row) => (row.kind === 'said' ? [[row.text, row.delivery]] : []))

test('a message that starts a turn shows a faint check on its way, one once hobkin has it, and two once that turn began', () => {
  const sending: SendingNote = { text: 'das', at: 1000 }
  const sent: SentNote[] = [{ text: 'das', at: 1000, run: runOf(3), started: true, noteId: '00000000-0000-4000-8000-000000000003' }]
  const read: HobkinConversation = { hobkin: working, turns: [...earlier, turn(3, 'das', 'running')] }
  const last = (rows: readonly PageRow[]) => marks(rows).at(-1)

  // What the user sent in turns hobkin has read back was taken in long ago.
  assert.deepEqual(marks(pageRows(pageTurns(before, waiting, []), { sending: null, activity: null })), [
    ['hey', 'received'],
    ['tell the main hobkin that i love him', 'received'],
  ])
  assert.deepEqual(last(pageRows(pageTurns(before, waiting, []), { sending, activity: null })), ['das', 'sending'])
  // The say answered, and the snapshot still says the hobkin waits: hobkin has it, and its turn has not begun.
  assert.deepEqual(last(pageRows(pageTurns(before, waiting, sent), { sending: null, activity: null })), ['das', 'waiting'])
  assert.deepEqual(last(pageRows(pageTurns(before, working, sent), { sending: null, activity: null })), ['das', 'received'])
  assert.deepEqual(last(pageRows(pageTurns(read, working, sent), { sending: null, activity: null })), ['das', 'received'])
})

test('a message added while a turn works shows two checks once hobkin has its receipt, and keeps them', () => {
  const read: HobkinConversation = { hobkin: working, turns: [...earlier, turn(3, 'das', 'running')] }
  const opened: SentNote = { text: 'das', at: 1000, run: runOf(3), started: true }
  const noteId = '00000000-0000-4000-8000-000000000001'
  const added: SentNote = { text: 'also the README', at: 1200, run: runOf(3), started: false, noteId }
  const rowsOf = (sent: readonly SentNote[], sending: SendingNote | null = null, conversation = read, hobkin = working) =>
    marks(pageRows(pageTurns(conversation, hobkin, sent), { sending, activity: null })).at(-1)

  assert.deepEqual(rowsOf([opened], { text: 'also the README', at: 1200 }), ['also the README', 'sending'])
  assert.deepEqual(rowsOf([opened, added]), ['also the README', 'waiting'])

  // A receipt for the same note under another run is not this one.
  const elsewhere = { [runOf(2)]: [{ noteId, at: 1300 }] }
  const notes = { [id]: [opened, added] }
  assert.equal(withReceipts(notes, elsewhere), notes, 'nothing new, the same notes')
  const receipts = { [runOf(3)]: [{ noteId, at: 1300 }] }
  const received = withReceipts(notes, receipts)
  assert.deepEqual(received[id]!.map((note) => note.receivedAt), [undefined, 1300])
  assert.deepEqual(rowsOf(received[id]!), ['also the README', 'received'])
  // Among the live turn's steps too.
  const steps = activityOf([tool('a'), tool('b')], { 'tool:a': 1100, 'tool:b': 1400 })
  assert.deepEqual(marks(pageRows(pageTurns(read, working, received[id]!), { sending: null, activity: steps })).at(-1), ['also the README', 'received'])

  // Once seen, the receipt stays: hobkin may let it go, as it does on a restart.
  assert.equal(withReceipts(received, {}), received)
  assert.equal(withReceipts(received, undefined), received)
  const ended = summary({ turns: 3 })
  const done: HobkinConversation = { hobkin: ended, turns: [...earlier, turn(3, 'das', 'completed', 'Done.')] }
  assert.deepEqual(rowsOf(received[id]!, null, done, ended), ['also the README', 'received'])
})

test('a message the turn ended without reading says so, and one sent with no id keeps one check', () => {
  const opened: SentNote = { text: 'das', at: 1000, run: runOf(3), started: true }
  const added: SentNote = { text: 'also the README', at: 1200, run: runOf(3), started: false, noteId: '00000000-0000-4000-8000-000000000001' }
  // A command Pi took as a message has no note id, so hobkin can give no receipt for it.
  const command: SentNote = { text: '/review', at: 1250, run: runOf(3), started: false }
  const read: HobkinConversation = { hobkin: working, turns: [...earlier, turn(3, 'das', 'running')] }
  const ended = summary({ turns: 3 })
  const done: HobkinConversation = { hobkin: ended, turns: [...earlier, turn(3, 'das', 'interrupted')] }
  const tail = (conversation: HobkinConversation, hobkin: HobkinSummary) => marks(pageRows(pageTurns(conversation, hobkin, [opened, added, command]), { sending: null, activity: null })).slice(-2)

  assert.deepEqual(tail(read, working), [['also the README', 'waiting'], ['/review', 'waiting']])
  // The snapshot says it waits again, and the read still has the turn running: its end is not known yet.
  assert.deepEqual(tail(read, ended), [['also the README', 'waiting'], ['/review', 'waiting']])
  assert.deepEqual(tail(done, ended), [['also the README', 'unconfirmed'], ['/review', 'waiting']])
})
