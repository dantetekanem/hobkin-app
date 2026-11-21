import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { after, mock, test } from 'node:test'
import type { HostMessage } from '../../shared/protocol/messages.ts'

// A page with animation frames, so the screen draws the host's state through its frame mirror as the window does.
const frames: (() => void)[] = []
const storage = { getItem: () => null, setItem() {}, removeItem() {} }
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { localStorage: storage, requestAnimationFrame: (then: () => void) => frames.push(then) },
})
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
// The app's `@/` imports point at ui/src, as Vite resolves them.
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
const { HostConnection } = await import('../src/lib/host/connection.ts')
mock.method(HostConnection.prototype, 'start', () => {
  throw new Error('Connection must stay stopped')
})
const { hostStore } = await import('../src/lib/host/client.ts')
const { applyHostMessage } = await import('../src/lib/host/state.ts')
const { screenStore } = await import('../src/lib/host/screen.ts')
const { useChat } = await import('../src/features/chat/chat-store.ts')
const { buildConversation } = await import('../src/features/chat/conversation.ts')
const { arrivalsOf, drawnOf } = await import('../src/features/chat/chat-rows.ts')
after(() => {
  mock.restoreAll()
  mock.timers.reset()
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'localStorage')
})

const send = (message: HostMessage) => hostStore.setState((state) => applyHostMessage(state, message), true)
const nextFrame = () => {
  for (const then of frames.splice(0)) then()
}

test('the message just sent keeps its row until the screen draws its stored copy, which does not rise in again', () => {
  const sentAt = 1_700_000_000_000
  send({ type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: null, viewState: null, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, signIn: { status: 'signed-in' } })
  send({ type: 'state', rev: 1, reset: true, set: { busy: true }, messages: [{ op: 'reset', messages: [] }] })
  nextFrame()
  useChat.setState({ outbox: { entries: [{ id: 1, text: 'hello there', at: sentAt, accepted: true }], delivered: [] } })

  // What ChatColumn and MessageList draw: the screen's messages and the chat's outbox, and what rises in.
  let drawn: ReturnType<typeof drawnOf> | null = null
  const draw = () => {
    const days = buildConversation({ messages: screenStore.getState().messages, outbox: useChat.getState().outbox.entries, now: sentAt + 5000 })
    const arrivals = arrivalsOf(days, 1, drawn)
    drawn = drawnOf(days, 1)
    return { keys: days.flatMap((day) => day.entries.map((entry) => entry.key)), arrivals: [...arrivals.keys()] }
  }
  draw()

  // hobkin stores the message. A draw can come before the next frame, as the chat store changed.
  send({ type: 'state', rev: 2, messages: [{ op: 'append', messages: [{ id: 'u1', role: 'user', content: 'hello there', at: sentAt + 10 }] }] })
  const beforeFrame = draw()
  nextFrame()
  const atFrame = draw()

  assert.deepEqual(beforeFrame, { keys: ['outbox:1'], arrivals: [] }, 'the row stays until the screen has the stored copy')
  assert.deepEqual(atFrame, { keys: ['u1'], arrivals: [] }, 'the stored copy takes its place without rising in')
})
