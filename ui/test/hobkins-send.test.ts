import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import type { HobkinConversation, HobkinSummary, HobkinTurn } from '#shared/protocol/hobkins.ts'
import { pageRows, pageTurns, type PageRow, type SendingNote, type SentNote } from '../src/features/hobkins/conversation.ts'

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

test('a read that has a turn running while the hobkin already waited says so', () => {
  // Not caught in flight: the read's own hobkin was waiting, so the page has no steps to keep and says what it has.
  const odd: HobkinConversation = { hobkin: summary({ turns: 3 }), turns: [...earlier, turn(3, 'das', 'running')] }
  const rows = pageRows(pageTurns(odd, summary({ turns: 3 }), []), { sending: null, activity: null })
  assert.deepEqual(rows.slice(-2).map((row) => row.kind), ['said', 'answer'])
  assert.ok(rows.every((row) => row.kind !== 'thinking'))
})
