import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { after, beforeEach, mock, test } from 'node:test'
import type { HostMessage } from '../../shared/protocol/messages.ts'
import type { StopControlTarget } from '../../shared/protocol/snapshot.ts'

// The chat store as the message input drives it during a turn, with the host's answers given by each test.
const frames: (() => void)[] = []
const storage = { getItem: () => null, setItem() {}, removeItem() {} }
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { localStorage: storage, requestAnimationFrame: (then: () => void) => frames.push(then) },
})
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { visibilityState: 'visible', getElementById: () => null, addEventListener() {}, removeEventListener() {} },
})
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
const { HostConnection } = await import('../src/lib/host/connection.ts')
mock.method(HostConnection.prototype, 'start', () => {
  throw new Error('Connection must stay stopped')
})
/** Each command the store sent, with a way to answer it. */
const sent: { name: string; args: Record<string, unknown>; answer: (value: unknown) => void; refuse: (error: Error) => void }[] = []
mock.method(HostConnection.prototype, 'command', (name: string, args: Record<string, unknown> = {}) =>
  // The list of commands is asked for each time hobkin opens, and has nothing to do with these keys.
  name === 'slash.list' ? Promise.resolve({ commands: [] }) : new Promise((answer, refuse) => sent.push({ name, args, answer, refuse })))
const { hostStore } = await import('../src/lib/host/client.ts')
const { applyHostMessage } = await import('../src/lib/host/state.ts')
const { useChat } = await import('../src/features/chat/chat-store.ts')
const { emptyOutbox } = await import('../src/features/chat/outbox.ts')
const { emptyDraft } = await import('../src/features/chat/draft.ts')
const { buildConversation } = await import('../src/features/chat/conversation.ts')
after(() => {
  mock.restoreAll()
  mock.timers.reset()
  for (const name of ['window', 'localStorage', 'document']) Reflect.deleteProperty(globalThis, name)
})

let rev = 1
const receive = (message: HostMessage) => hostStore.setState((state) => applyHostMessage(state, message), true)
const settle = () => new Promise((resolve) => setImmediate(resolve))
const turn: StopControlTarget = { kind: 'main', runId: 'turn:A', parentId: null, rootId: 'turn:A', label: 'Main conversation', canStop: true, canForce: true }

/** hobkin live, working on a turn of the main chat or idle. */
function hobkin({ working, mainStopped = null }: { working: boolean; mainStopped?: string | null }) {
  receive({ type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: null, viewState: null, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, signIn: { status: 'signed-in' } })
  receive({ type: 'state', rev: rev++, reset: true, set: { busy: working, mainStopped, stopControls: { home: '/fake/home', epoch: 'e1', targets: working ? [turn] : [] } }, messages: [{ op: 'reset', messages: [] }] })
}
const typed = (text: string) => useChat.getState().change({ type: 'typed', text })
const waiting = () => useChat.getState().outbox.entries.filter((entry) => entry.queue).map(({ text, queue }) => `${queue}: ${text}`)
const drawnInConversation = () => buildConversation({ messages: [], outbox: useChat.getState().outbox.entries, now: Date.now() }).flatMap((day) => day.entries).length

beforeEach(() => {
  sent.length = 0
  useChat.setState({ outbox: emptyOutbox, draft: emptyDraft, problem: null })
})

test('during a turn Enter steers and Alt+Enter follows up; each waits above the input, not in the conversation, until it is read', async () => {
  hobkin({ working: true })
  typed('Only weekdays')
  const steering = useChat.getState().send()
  typed('Then sum it up')
  const following = useChat.getState().sendDuring('follow-up')

  assert.deepEqual(sent.map(({ name, args }) => [name, args.text, args.during]), [['conversation.send', 'Only weekdays', undefined], ['conversation.send', 'Then sum it up', 'follow-up']])
  assert.deepEqual(waiting(), ['steer: Only weekdays', 'follow-up: Then sum it up'], 'each says how it waits from the moment it is sent')
  assert.equal(drawnInConversation(), 0)

  sent[0]!.answer({ id: 's1', queued: true })
  sent[1]!.answer({ id: 'f1', queued: true })
  await Promise.all([steering, following])
  assert.deepEqual(waiting(), ['steer: Only weekdays', 'follow-up: Then sum it up'])
})

test('a message the host started a turn with goes into the conversation', async () => {
  hobkin({ working: true })
  typed('Plan the week')
  const sending = useChat.getState().send()
  sent[0]!.answer({ id: 'u1', queued: false })
  await sending
  assert.deepEqual(waiting(), [])
  assert.equal(drawnInConversation(), 1)
})

test('Control+Enter interrupts the turn and sends at once, and what the turn never read comes back to the input', async () => {
  hobkin({ working: true })
  typed('Plan the month instead')
  const sending = useChat.getState().sendDuring('interrupt')
  assert.deepEqual([sent[0]!.args.text, sent[0]!.args.during], ['Plan the month instead', 'interrupt'])
  assert.deepEqual(waiting(), [], 'it starts a turn of its own, so it waits for none')

  typed('half a thought')
  sent[0]!.answer({ id: 'u2', queued: false, unsent: ['Only weekdays'] })
  assert.equal(await sending, true)
  assert.equal(useChat.getState().draft.text, 'Only weekdays\n\nhalf a thought')
})

test('Alt+Up brings what waits back into the input and takes its rows away', async () => {
  hobkin({ working: true })
  typed('Only weekdays')
  void useChat.getState().send()
  sent[0]!.answer({ id: 's1', queued: true })
  await settle()
  typed('and Friday off')

  useChat.getState().dequeue()
  assert.equal(sent[1]!.name, 'conversation.dequeue')
  sent[1]!.answer({ unsent: ['Only weekdays'] })
  await settle()
  assert.equal(useChat.getState().draft.text, 'Only weekdays\n\nand Friday off')
  assert.deepEqual(waiting(), [])
})

test('Continue asks the host to go on with the stopped turn, and says so when it cannot', async () => {
  hobkin({ working: false, mainStopped: 'turn:A' })
  useChat.getState().continueTurn()
  assert.equal(sent[0]!.name, 'conversation.continue')

  useChat.getState().continueTurn()
  sent[1]!.refuse(Error('Nothing to continue: the last turn was not one you stopped.'))
  await settle()
  assert.equal(useChat.getState().problem, 'Not continued: Nothing to continue: the last turn was not one you stopped.')
})

test('a message waiting for the turn leaves its row when the model reads it, matched by its words before its time', async () => {
  const { settleOutbox } = await import('../src/features/chat/outbox.ts')
  const entries = [
    { id: 1, text: 'Then sum it up', at: 100, accepted: true, queue: 'follow-up' as const },
    { id: 2, text: 'Only weekdays', at: 200, accepted: true, queue: 'steer' as const },
  ]
  // Pi reads what steers the turn before what follows it up, whichever was sent first.
  const settled = settleOutbox({ entries, delivered: [] }, [{ id: 'u2', role: 'user', content: 'Only weekdays', at: 300 }], true)
  assert.deepEqual(settled.entries.map(({ text }) => text), ['Then sum it up'])
})
