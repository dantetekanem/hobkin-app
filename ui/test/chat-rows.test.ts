import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { after, mock, test } from 'node:test'
import { createElement, memo, useEffect, useMemo } from 'react'
import type { HostMessage } from '../../shared/protocol/messages.ts'
import type { ChatMessage } from '../../shared/protocol/snapshot.ts'
import type { TurnEvent } from '../../shared/protocol/turn.ts'
import type { Entry } from '../src/features/chat/conversation.ts'
import type { OutboxEntry } from '../src/features/chat/outbox.ts'
import { applyHostMessage } from '../src/lib/host/state.ts'
import { mountCounting } from './render-count.ts'

Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
} })
// The app's `@/` imports point at ui/src, as Vite resolves them.
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
const { HostConnection } = await import('../src/lib/host/connection.ts')
mock.method(HostConnection.prototype, 'start', () => { throw new Error('Connection must stay stopped') })
mock.method(HostConnection.prototype, 'command', async () => { throw new Error('Nothing here sends commands') })
const { hostStore } = await import('../src/lib/host/client.ts')
const { useHost } = await import('../src/lib/host/index.ts')
const { buildConversation } = await import('../src/features/chat/conversation.ts')
const { arrangementOf, arrivalsOf, drawnOf } = await import('../src/features/chat/chat-rows.ts')
after(() => {
  mock.restoreAll()
  mock.timers.reset()
  Reflect.deleteProperty(globalThis, 'window')
})

const NOW = Date.parse('2026-11-21T15:00:00Z')
let rev = 1
let seq = 1
const send = (message: HostMessage) => hostStore.setState((state) => applyHostMessage(state, message), true)
const turn = (event: TurnEvent): HostMessage => ({ type: 'turn', seq: seq++, event })

const stored: ChatMessage[] = Array.from({ length: 40 }, (_, index) => ({
  id: `m${index}`,
  role: index % 2 ? 'assistant' : 'user',
  content: `Message ${index} with **some** words`,
  at: NOW - (40 - index) * 60000,
}))
// Two identical notices in a row fold into one line, and one message the user sent waits in the outbox.
stored.push({ id: 'n1', role: 'notice', content: 'Morning recap finished', tone: 'useful', at: NOW - 30000 }, { id: 'n2', role: 'notice', content: 'Morning recap finished', tone: 'useful', at: NOW - 20000 })
const outbox: OutboxEntry[] = [{ id: 1, text: 'And one more thing', at: NOW - 10000, accepted: true }]

send({ type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: null, viewState: null, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, signIn: { status: 'signed-in' } })
send({ type: 'state', rev: rev++, reset: true, set: { busy: true }, messages: [{ op: 'reset', messages: stored }] })

test('a token draws the writing row only', async () => {
  const draws = new Map<string, number>()
  // The chat's rows as MessageList draws them: one memo row per entry, with what chat-rows.ts gives it.
  const Row = memo(function Row({ entry }: { entry: Entry; order: number | null; arrangement: string }) {
    draws.set(entry.key, (draws.get(entry.key) ?? 0) + 1)
    return null
  })
  let before: ReturnType<typeof drawnOf> | null = null
  function List() {
    const messages = useHost((state) => state.messages)
    const live = useHost((state) => state.live)
    const epoch = useHost((state) => state.epoch)
    const days = useMemo(() => buildConversation({ messages, live, outbox, now: NOW, timeZone: 'UTC' }), [messages, live])
    const arrivals = arrivalsOf(days, epoch, before)
    const arrangement = arrangementOf(days)
    useEffect(() => {
      before = drawnOf(days, epoch)
    })
    return days.flatMap((day) => day.entries.map((entry) => createElement(Row, { key: entry.key, entry, order: arrivals.get(entry.key) ?? null, arrangement })))
  }
  const mounted = await mountCounting(() => createElement(List))
  // Forty messages, the folded notices and the message waiting to be stored.
  assert.equal(draws.size, 42)

  await mounted.change(() => send(turn({ kind: 'message-start', role: 'assistant' })))
  await mounted.change(() => send(turn({ kind: 'text-start', index: 0 })))
  await mounted.change(() => send(turn({ kind: 'text-delta', index: 0, delta: 'Here ' })))
  // A turn that has said nothing yet draws nothing. Its first word arrives as a row: every other row learns the
  // list changed, once.
  assert.equal(draws.get('live:0'), 1)
  assert.ok([...draws].every(([key, count]) => key === 'live:0' || count === 2))
  draws.clear()

  for (const word of ['is ', 'what ', 'I ', 'found ', 'in ', 'the ', 'logs ', 'this ', 'morning. ']) {
    await mounted.change(() => send(turn({ kind: 'text-delta', index: 0, delta: word })))
  }
  assert.deepEqual([...draws], [['live:0', 9]])
  await mounted.unmount()
})
