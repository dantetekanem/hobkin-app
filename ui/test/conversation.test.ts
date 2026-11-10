import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HostMessage } from '#shared/protocol/messages.ts'
import type { ChatMessage } from '#shared/protocol/snapshot.ts'
import type { TurnEvent } from '#shared/protocol/turn.ts'
import { buildConversation, type Entry } from '../src/features/chat/conversation.ts'
import { applyHostMessage, initialHostState, type HostState } from '../src/lib/host/state.ts'
import { storedBesideLive } from '../src/lib/host/live.ts'

const NOW = Date.parse('2026-11-09T15:00:00Z')
const keys = (entries: Entry[]) => entries.map(({ key }) => key)

test('groups stored messages by day', () => {
  const messages: ChatMessage[] = [
    { id: 'a', role: 'user', content: 'An older question', at: '2025-12-30T09:00:00Z' },
    { id: 'b', role: 'user', content: 'Last week', at: '2026-11-05T09:00:00Z' },
    { id: 'c', role: 'assistant', content: 'Its answer', at: '2026-11-05T09:01:00Z' },
    { id: 'd', role: 'user', content: 'Late yesterday', at: '2026-11-08T23:30:00Z' },
    // hobkin stamps some messages in milliseconds.
    { id: 'e', role: 'notice', content: 'Morning recap finished', tone: 'useful', at: Date.parse('2026-11-09T08:00:00Z') },
    { id: 'f', role: 'assistant', content: 'The newest', at: '2026-11-09T14:59:00Z' },
  ]
  const days = buildConversation({ messages, now: NOW, timeZone: 'UTC' })

  assert.deepEqual(
    days.map((day) => [day.label, keys(day.entries)]),
    [
      ['Tue, Dec 30, 2025', ['a']],
      ['Thu, Nov 5', ['b', 'c']],
      ['Yesterday', ['d']],
      ['Today', ['e', 'f']],
    ],
  )
  assert.equal(days.at(-1)?.entries.at(-1)?.key, 'f', 'the newest message is last, where the view opens')
  assert.equal(new Set(days.map((day) => day.key)).size, days.length)

  // A day is the user's day: the same moment falls on the evening before further west.
  const lateNight: ChatMessage[] = [{ id: 'x', role: 'user', content: 'Hi', at: '2026-11-09T03:00:00Z' }]
  assert.equal(buildConversation({ messages: lateNight, now: NOW, timeZone: 'UTC' })[0]?.label, 'Today')
  assert.equal(buildConversation({ messages: lateNight, now: NOW, timeZone: 'America/Los_Angeles' })[0]?.label, 'Yesterday')

  // A message with no time stays with the day before it, and a conversation with no times has one group.
  const undated = buildConversation({ messages: [messages[1]!, { id: 'u', role: 'assistant', content: 'No time' }], now: NOW, timeZone: 'UTC' })
  assert.deepEqual(undated.map((day) => [day.label, keys(day.entries)]), [['Thu, Nov 5', ['b', 'u']]])
  assert.deepEqual(buildConversation({ messages: [{ id: 'u', role: 'assistant', content: 'No time' }], now: NOW, timeZone: 'UTC' }).map((day) => day.label), ['Earlier'])
  assert.deepEqual(buildConversation({ messages: [], now: NOW, timeZone: 'UTC' }), [])
})

test('day labels follow the current local date across midnight, DST and timezone changes', () => {
  const message: ChatMessage = { id: 'before-midnight', role: 'assistant', content: 'Keep this reply', at: '2026-03-08T04:30:00Z' }
  const labels = (now: string, timeZone: string) => buildConversation({ messages: [message], now: Date.parse(now), timeZone }).map(({ key, label }) => [key, label])

  assert.deepEqual(labels('2026-03-08T04:45:00Z', 'America/New_York'), [['2026-03-07', 'Today']])
  assert.deepEqual(labels('2026-03-08T07:30:00Z', 'America/New_York'), [['2026-03-07', 'Yesterday']])
  assert.deepEqual(labels('2026-03-09T04:30:00Z', 'America/New_York'), [['2026-03-07', 'Sat, Mar 7']])
  assert.deepEqual(labels('2026-03-08T07:30:00Z', 'Asia/Tokyo'), [['2026-03-08', 'Today']])
  assert.deepEqual(labels('2026-03-08T07:30:00Z', 'America/New_York'), [['2026-03-07', 'Yesterday']], 'a previous call cannot pin another timezone')

  const repeatedHour: ChatMessage[] = [
    { id: 'first', role: 'user', content: 'Before fallback', at: '2026-11-01T05:30:00Z' },
    { id: 'second', role: 'assistant', content: 'After fallback', at: '2026-11-01T06:30:00Z' },
  ]
  const days = buildConversation({ messages: repeatedHour, now: Date.parse('2026-11-02T05:30:00Z'), timeZone: 'America/New_York' })
  assert.deepEqual(days.map(({ key, label, entries }) => [key, label, keys(entries)]), [['2026-11-01', 'Yesterday', ['first', 'second']]])
})

test('collapses identical notices', () => {
  const notice = (id: string, content: string, at: string, tone: ChatMessage['tone'] = 'quiet'): ChatMessage => ({ id, role: 'notice', content, tone, at })
  const messages: ChatMessage[] = [
    notice('n1', 'Report available for Morning recap', '2026-11-09T08:00:00Z'),
    notice('n2', 'Report available for Morning recap', '2026-11-09T08:05:00Z'),
    notice('n3', 'Report available for Morning recap', '2026-11-09T08:10:00Z'),
    { id: 'u1', role: 'user', content: 'Thanks', at: '2026-11-09T08:11:00Z' },
    notice('n4', 'Report available for Morning recap', '2026-11-09T09:00:00Z'),
    notice('n5', 'Deploy check: the build is red', '2026-11-09T09:01:00Z', 'critical'),
    notice('n6', 'Deploy check: the build is red', '2026-11-09T09:02:00Z', 'critical'),
    notice('n7', 'Deploy check: the build is red', '2026-11-09T09:03:00Z', 'blocked'),
    { id: 's1', role: 'system', content: 'You stopped hobkin.', at: '2026-11-09T09:04:00Z' },
    { id: 's2', role: 'system', content: 'You stopped hobkin.', at: '2026-11-09T09:05:00Z' },
  ]
  const [today] = buildConversation({ messages, now: NOW, timeZone: 'UTC' })
  const shown = today!.entries.map((entry) => (entry.kind === 'notice' ? `${entry.tone} ${entry.text} x${entry.count}` : entry.text))

  assert.deepEqual(shown, [
    'quiet Report available for Morning recap x3',
    'Thanks',
    'quiet Report available for Morning recap x1',
    'critical Deploy check: the build is red x2',
    // The same words with another tone are another notice.
    'blocked Deploy check: the build is red x1',
    // A line about what the user did is not a notice from a run, so each one stays.
    'system You stopped hobkin. x1',
    'system You stopped hobkin. x1',
  ])
  const collapsed = today!.entries[0]!
  assert.equal(collapsed.at, Date.parse('2026-11-09T08:10:00Z'), 'it keeps the time of the latest')
  assert.equal(collapsed.key, 'n1', 'and its place in the list, so it does not jump when another arrives')

  // The same notice on the next day starts over.
  const acrossDays = buildConversation({
    messages: [notice('y', 'Report available for Morning recap', '2026-11-08T08:00:00Z'), notice('t', 'Report available for Morning recap', '2026-11-09T08:00:00Z')],
    now: NOW,
    timeZone: 'UTC',
  })
  assert.deepEqual(acrossDays.map((day) => day.entries.map((entry) => entry.kind === 'notice' && entry.count)), [[1], [1]])
})

const hello: HostMessage = { type: 'hello', protocol: 1, home: '/home', model: 'scripted', owner: { state: 'live', limits: { images: 4, imageBytes: 67108864 } }, signIn: { status: 'signed-in' }, models: null, viewState: null }
const user: ChatMessage = { id: 'u1', role: 'user', content: 'Say hello', at: '2026-11-09T14:00:00Z' }
const turn = (state: HostState, ...events: TurnEvent[]) => events.reduce((now, event, index) => applyHostMessage(now, { type: 'turn', seq: index + 1, event }), state)
const shown = (state: HostState) =>
  buildConversation({ messages: state.messages, live: state.live, now: NOW, timeZone: 'UTC' }).flatMap((day) =>
    day.entries.map((entry) => (entry.kind === 'message' ? `${entry.role}${entry.state ? ` (${entry.state})` : ''}: ${entry.text}` : entry.text)),
  )

test('applies deltas to the open message and replaces it with the stored one', () => {
  let state = applyHostMessage(initialHostState, hello)
  state = applyHostMessage(state, { type: 'state', rev: 1, reset: true, set: { busy: true }, messages: [{ op: 'reset', messages: [user] }] })
  assert.deepEqual(shown(state), ['user: Say hello'])

  // Text appears as it arrives, after everything stored.
  state = turn(state, { kind: 'start' }, { kind: 'message-start', role: 'user' }, { kind: 'message-end', role: 'user' })
  assert.deepEqual(shown(state), ['user: Say hello'], 'only a reply is written live')
  state = turn(state, { kind: 'message-start', role: 'assistant' }, { kind: 'thinking-start', index: 0 }, { kind: 'thinking-end', index: 0 })
  assert.deepEqual(shown(state), ['user: Say hello'], 'nothing shows before the first word')
  state = turn(state, { kind: 'text-start', index: 1 }, { kind: 'text-delta', index: 1, delta: 'Hel' })
  assert.deepEqual(shown(state), ['user: Say hello', 'assistant (writing): Hel'])
  state = turn(state, { kind: 'text-delta', index: 1, delta: 'lo' })
  assert.deepEqual(shown(state), ['user: Say hello', 'assistant (writing): Hello'])

  // A refresh in the middle of the reply changes nothing about it.
  state = applyHostMessage(state, { type: 'state', rev: 2, set: { doing: 'writing' } })
  assert.deepEqual(shown(state), ['user: Say hello', 'assistant (writing): Hello'])

  // The block's own text is the last word on it, and the finished reply stays until hobkin has stored it.
  state = turn(state, { kind: 'text-end', index: 1, text: 'Hello!' }, { kind: 'message-end', role: 'assistant', stop: 'stop' })
  assert.deepEqual(shown(state), ['user: Say hello', 'assistant: Hello!'])

  // The stored message takes its place: one reply on screen, never two and never none.
  const stored: ChatMessage = { id: 'a1', role: 'assistant', content: 'Hello!', at: '2026-11-09T14:00:05Z' }
  state = applyHostMessage(state, { type: 'state', rev: 3, set: { busy: false, doing: null }, messages: [{ op: 'append', messages: [stored] }] })
  assert.equal(state.live, null)
  assert.deepEqual(shown(state), ['user: Say hello', 'assistant: Hello!'])
  assert.deepEqual(keys(buildConversation({ messages: state.messages, live: state.live, now: NOW, timeZone: 'UTC' })[0]!.entries), ['u1', 'a1'])
})

test('a turn of several replies shows each once, whichever arrives first', () => {
  let state = applyHostMessage(initialHostState, hello)
  state = applyHostMessage(state, { type: 'state', rev: 1, reset: true, set: { busy: true }, messages: [{ op: 'reset', messages: [user] }] })

  const write = (text: string): TurnEvent[] => [
    { kind: 'message-start', role: 'assistant' },
    { kind: 'text-start', index: 0 },
    { kind: 'text-delta', index: 0, delta: text },
    { kind: 'text-end', index: 0, text },
    { kind: 'message-end', role: 'assistant', stop: 'toolUse' },
  ]
  // The second reply starts before hobkin has stored the first.
  state = turn(state, ...write('Looking it up.'), { kind: 'message-start', role: 'assistant' }, { kind: 'text-start', index: 0 }, { kind: 'text-delta', index: 0, delta: 'Found' })
  assert.deepEqual(shown(state), ['user: Say hello', 'assistant: Looking it up.', 'assistant (writing): Found'])

  state = applyHostMessage(state, { type: 'state', rev: 2, messages: [{ op: 'append', messages: [{ id: 'a1', role: 'assistant', content: 'Looking it up.' }] }] })
  assert.deepEqual(shown(state), ['user: Say hello', 'assistant: Looking it up.', 'assistant (writing): Found'])

  // A reply that was only a tool call has no words, so nothing of it is kept waiting for a stored copy.
  state = turn(state, { kind: 'text-end', index: 0, text: 'Found it.' }, { kind: 'message-end', role: 'assistant', stop: 'toolUse' })
  state = turn(state, { kind: 'message-start', role: 'assistant' }, { kind: 'tool-call', index: 0 }, { kind: 'message-end', role: 'assistant', stop: 'toolUse' })
  state = applyHostMessage(state, { type: 'state', rev: 3, messages: [{ op: 'append', messages: [{ id: 'a2', role: 'assistant', content: 'Found it.' }] }] })
  assert.deepEqual(shown(state), ['user: Say hello', 'assistant: Looking it up.', 'assistant: Found it.'])
  assert.equal(state.live, null)

  // A turn that stops in the middle of a reply leaves nothing live behind once hobkin says it is over.
  state = turn(state, { kind: 'message-start', role: 'assistant' }, { kind: 'text-start', index: 0 }, { kind: 'text-delta', index: 0, delta: 'Half a' })
  state = applyHostMessage(state, { type: 'state', rev: 4, set: { busy: false } })
  assert.equal(state.live, null)
  assert.deepEqual(shown(state).at(-1), 'assistant: Found it.')
})

test('live replies hide only newly stored assistant messages, preserving stored order and objects', () => {
  const messages: ChatMessage[] = [
    { id: 'old', role: 'assistant', content: 'Earlier reply' },
    { id: 'new', role: 'assistant', content: 'Still being streamed' },
    { id: 'user', role: 'user', content: 'Another question' },
    { id: 'notice', role: 'notice', content: 'A report arrived' },
  ]
  assert.equal(storedBesideLive(messages, null), messages)
  const shown = storedBesideLive(messages, { known: ['old', 'old'], replies: [], opened: 0 })
  assert.deepEqual(shown.map(({ id }) => id), ['old', 'user', 'notice'])
  for (const message of shown) assert.equal(message, messages.find(({ id }) => id === message.id))
  assert.equal(messages.length, 4, 'the source history is unchanged')
})

test('what the app says for the user only sits where it was said', () => {
  const stored: ChatMessage[] = [
    { id: 'u1', role: 'user', content: 'Before the help', at: '2026-11-09T14:00:00Z' },
    { id: 'u2', role: 'user', content: 'After the help', at: '2026-11-09T14:10:00Z' },
  ]
  const help: ChatMessage = { id: 'local:note:1', role: 'assistant', content: 'hobkin runs your checks on a schedule.', at: Date.parse('2026-11-09T14:05:00Z') }
  const days = buildConversation({ messages: stored, local: [help], now: NOW, timeZone: 'UTC' })

  assert.deepEqual(keys(days[0]!.entries), ['u1', 'local:note:1', 'u2'])
  // With nothing newer than it, it is the last thing said.
  const late = { ...help, id: 'local:note:2', at: Date.parse('2026-11-09T14:30:00Z') }
  assert.deepEqual(keys(buildConversation({ messages: stored, local: [help, late], now: NOW, timeZone: 'UTC' })[0]!.entries), ['u1', 'local:note:1', 'u2', 'local:note:2'])
})
