import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { after, beforeEach, mock, test } from 'node:test'
import type { HostMessage } from '../../shared/protocol/messages.ts'

// A page with animation frames and a visibility the tests turn, so the screen draws the host's state through its frame
// mirror as the window does, and takes nothing while hidden.
const frames: (() => void)[] = []
const page = { visibilityState: 'visible', shown: [] as (() => void)[] }
const storage = { getItem: () => null, setItem() {}, removeItem() {} }
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { localStorage: storage, requestAnimationFrame: (then: () => void) => frames.push(then) },
})
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: {
    get visibilityState() {
      return page.visibilityState
    },
    getElementById: () => null,
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'visibilitychange') page.shown.push(listener)
    },
    removeEventListener() {},
  },
})
// The app's `@/` imports point at ui/src, as Vite resolves them.
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
const { HostConnection } = await import('../src/lib/host/connection.ts')
mock.method(HostConnection.prototype, 'start', () => {
  throw new Error('Connection must stay stopped')
})
// The host answers `conversation.send` when a test says.
let answer: (value: unknown) => void = () => {}
mock.method(HostConnection.prototype, 'command', () => new Promise((resolve) => (answer = resolve)))
const { hostStore } = await import('../src/lib/host/client.ts')
const { applyHostMessage } = await import('../src/lib/host/state.ts')
const { screenStore } = await import('../src/lib/host/screen.ts')
const { useChat } = await import('../src/features/chat/chat-store.ts')
const { emptyOutbox } = await import('../src/features/chat/outbox.ts')
const { buildConversation } = await import('../src/features/chat/conversation.ts')
const { arrivalsOf, drawnOf } = await import('../src/features/chat/chat-rows.ts')
after(() => {
  mock.restoreAll()
  mock.timers.reset()
  for (const name of ['window', 'localStorage', 'document']) Reflect.deleteProperty(globalThis, name)
})

let rev = 1
const receive = (message: HostMessage) => hostStore.setState((state) => applyHostMessage(state, message), true)
const nextFrame = () => {
  for (const then of frames.splice(0)) then()
}
const settle = () => new Promise((resolve) => setImmediate(resolve))
const turnTo = (visibility: 'visible' | 'hidden') => {
  page.visibilityState = visibility
  for (const listener of page.shown) listener()
}

/** hobkin idle or working, with an empty conversation, drawn by the screen. */
function startWith({ busy }: { busy: boolean }) {
  receive({ type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: null, viewState: null, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, signIn: { status: 'signed-in' } })
  receive({ type: 'state', rev: rev++, reset: true, set: { busy }, messages: [{ op: 'reset', messages: [] }] })
  nextFrame()
}

/** hobkin stores what was sent, and works on it. */
const stored = (text: string, at: number): HostMessage => ({ type: 'state', rev: rev++, set: { busy: true }, messages: [{ op: 'append', messages: [{ id: 'u1', role: 'user', content: text, at: at + 10 }] }] })

/** What ChatColumn and MessageList draw: the screen's messages and the chat's outbox, and what rises in. */
function drawing() {
  let drawn: ReturnType<typeof drawnOf> | null = null
  return () => {
    const days = buildConversation({ messages: screenStore.getState().messages, outbox: useChat.getState().outbox.entries, now: Date.now() + 5000 })
    const arrivals = arrivalsOf(days, 1, drawn)
    drawn = drawnOf(days, 1)
    const keys = days.flatMap((day) => day.entries.map((entry) => entry.key))
    return { rows: keys.map((key) => (key.startsWith('outbox:') ? 'sent' : key)), arrivals: [...arrivals.keys()] }
  }
}

/** Sends `text` through the chat store, as Return does, and answers when it is told to. */
function sendThrough(text: string) {
  const sending = useChat.getState().send(text)
  const at = useChat.getState().outbox.entries.at(-1)!.at
  return {
    at,
    accept: async () => {
      answer({ id: 'u1', queued: false })
      await sending
      await settle()
    },
  }
}

beforeEach(() => useChat.setState({ outbox: emptyOutbox }))

test('the message just sent keeps its row until the screen draws its stored copy, which does not rise in again', () => {
  startWith({ busy: true })
  const sentAt = Date.now()
  useChat.setState({ outbox: { entries: [{ id: 1, text: 'hello there', at: sentAt, accepted: true }], delivered: [] } })
  const draw = drawing()
  draw()

  receive(stored('hello there', sentAt))
  const beforeFrame = draw()
  nextFrame()

  assert.deepEqual(beforeFrame, { rows: ['sent'], arrivals: [] }, 'the row stays until the screen has the stored copy')
  assert.deepEqual(draw(), { rows: ['u1'], arrivals: [] }, 'the stored copy takes its place without rising in')
})

test('a message sent while hobkin is idle keeps its row when hobkin stores it and then answers, within one frame', async () => {
  startWith({ busy: false })
  const draw = drawing()
  const send = sendThrough('hello there')
  draw()

  receive(stored('hello there', send.at))
  await send.accept()
  const beforeFrame = draw()
  nextFrame()

  assert.deepEqual(beforeFrame, { rows: ['sent'], arrivals: [] })
  assert.deepEqual(draw(), { rows: ['u1'], arrivals: [] })
})

test('a message sent while hobkin is idle keeps its row when hobkin answers before it stores it', async () => {
  startWith({ busy: false })
  const draw = drawing()
  const send = sendThrough('hello there')
  draw()

  await send.accept()
  const afterAnswer = draw()
  nextFrame()
  const atNextFrame = draw()
  receive(stored('hello there', send.at))
  nextFrame()

  assert.deepEqual(afterAnswer, { rows: ['sent'], arrivals: [] }, 'an answer alone does not take the row away')
  assert.deepEqual(atNextFrame, { rows: ['sent'], arrivals: [] }, 'nor a frame that shows hobkin still idle')
  assert.deepEqual(draw(), { rows: ['u1'], arrivals: [] })
})

test('a message sent while hobkin works stays until its copy is stored, and goes when the turn ends without it', async () => {
  startWith({ busy: true })
  const draw = drawing()
  const send = sendThrough('and the tests too')
  draw()

  await send.accept()
  nextFrame()
  const whileWorking = draw()
  receive({ type: 'state', rev: rev++, set: { busy: false } })
  nextFrame()

  assert.deepEqual(whileWorking, { rows: ['sent'], arrivals: [] })
  assert.deepEqual(draw().rows, [], 'hobkin took it and the turn ended without storing it')
})

test('a message sent just before the window is hidden is right when it shows again', async () => {
  startWith({ busy: false })
  const draw = drawing()
  const send = sendThrough('hello there')
  draw()

  turnTo('hidden')
  receive(stored('hello there', send.at))
  await send.accept()
  nextFrame()
  const whileHidden = { rows: useChat.getState().outbox.entries.length, shown: screenStore.getState().messages.length }
  turnTo('visible')

  assert.deepEqual(whileHidden, { rows: 1, shown: 0 }, 'hidden, the screen and the outbox stay as they were drawn')
  assert.deepEqual(draw(), { rows: ['u1'], arrivals: [] }, 'shown, the stored copy takes the row in one draw')
})
