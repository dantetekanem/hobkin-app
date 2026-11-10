import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HostMessage, StateMessage } from '#shared/protocol/messages.ts'
import type { ChatMessage } from '#shared/protocol/snapshot.ts'
import { HostConnection, type HostAddress, type SocketLike } from '../src/lib/host/connection.ts'
import { applyHostMessage, applyLink, initialHostState, type HostState } from '../src/lib/host/state.ts'

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  readonly sent: string[] = []
  readonly url: string
  closed = false

  constructor(url: string) {
    this.url = url
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.onclose?.()
  }

  receive(message: HostMessage) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

const hello = (home: string): HostMessage => ({ type: 'hello', protocol: 1, home, model: 'scripted', owner: { state: 'live', limits: { images: 4, imageBytes: 67108864 } }, signIn: { status: 'signed-in' }, models: null, viewState: null })
const said = (id: string, content: string): ChatMessage => ({ id, role: 'assistant', content })
const everything = (rev: number, busy: boolean, messages: ChatMessage[]): StateMessage => ({
  type: 'state',
  rev,
  reset: true,
  set: { busy, connection: 'connected' },
  messages: [{ op: 'reset', messages }],
  owner: { state: 'live', limits: { images: 4, imageBytes: 67108864 } },
})
const settle = () => new Promise((resolve) => setImmediate(resolve))

/** A connection wired to a store the way the app wires it, with sockets and timers the test controls. */
function harness(addresses: (HostAddress | null)[]) {
  const sockets: FakeSocket[] = []
  const timers: { run: () => void; ms: number }[] = []
  let state: HostState = initialHostState
  const connection = new HostConnection({
    discover: async () => addresses.shift() ?? null,
    createSocket: (url) => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    },
    schedule: (run, ms) => void timers.push({ run, ms }),
    onMessage: (message) => (state = applyHostMessage(state, message)),
    onLink: (link) => (state = applyLink(state, link)),
  })
  return { connection, sockets, timers, state: () => state }
}

test('reconnects and replaces stale state', async () => {
  const h = harness([
    { url: 'ws://127.0.0.1:5188', token: 'first token' },
    null,
    { url: 'ws://127.0.0.1:5188', token: 'second/token' },
  ])
  h.connection.start()
  assert.equal(h.state().link, 'connecting')
  await settle()

  const first = h.sockets[0]!
  assert.equal(first.url, 'ws://127.0.0.1:5188/?token=first%20token')
  first.onopen?.()
  first.receive(hello('/home/one'))
  first.receive(everything(1, true, [said('a', 'Before the restart')]))
  assert.equal(h.state().link, 'open')
  assert.deepEqual(h.state().messages.map(({ content }) => content), ['Before the restart'])

  // A command waiting for its result when the host goes away fails instead of hanging.
  const waiting = h.connection.command('conversation.send', { text: 'Are you there?' })
  assert.equal(JSON.parse(first.sent[0]!).name, 'conversation.send')
  first.close()
  await assert.rejects(waiting, /Disconnected/)

  // The host is gone. What was on screen stays, marked as no longer live.
  assert.equal(h.state().link, 'lost')
  assert.equal(h.state().messages.length, 1)
  assert.equal(h.timers.length, 1, 'a retry is waiting, with nobody asking for it')
  await assert.rejects(h.connection.command('conversation.send', { text: 'Still there?' }), /Disconnected/)

  // The first retry finds no host yet. The next one is further off.
  h.timers.shift()!.run()
  await settle()
  assert.equal(h.sockets.length, 1)
  assert.equal(h.state().link, 'lost')
  assert.equal(h.timers.length, 1)

  // The restarted host has a new token, and the UI asks for it again instead of using the old one.
  h.timers.shift()!.run()
  await settle()
  const second = h.sockets[1]!
  assert.equal(second.url, 'ws://127.0.0.1:5188/?token=second%2Ftoken')
  second.onopen?.()
  second.receive(hello('/home/one'))
  assert.equal(h.state().messages.length, 1, 'the old view stays until the new one is here, so nothing flashes empty')
  second.receive(everything(0, false, [said('b', 'After the restart')]))

  assert.equal(h.state().link, 'open')
  assert.deepEqual(h.state().messages.map(({ content }) => content), ['After the restart'])
  assert.equal(h.state().snapshot.busy, false)
  assert.equal(h.timers.length, 0)

  // Results find their command again on the new connection.
  const sent = h.connection.command('conversation.send', { text: 'Welcome back' })
  const { id } = JSON.parse(second.sent[0]!)
  second.receive({ type: 'result', id, ok: true, value: { id: 'run', queued: false } })
  assert.deepEqual(await sent, { id: 'run', queued: false })

  const refused = h.connection.command('conversation.send', { text: 'x' })
  second.receive({ type: 'result', id: JSON.parse(second.sent[1]!).id, ok: false, error: { code: 'unavailable', message: 'hobkin is still starting.' } })
  await assert.rejects(refused, /still starting/)
})

test('stopping and starting again in one breath opens a single connection', async () => {
  // React mounts, unmounts and mounts again in development. The first start must not leave a second socket behind.
  const address = { url: 'ws://127.0.0.1:5188', token: 't' }
  const h = harness([address, address])
  h.connection.start()
  h.connection.stop()
  h.connection.start()
  await settle()

  assert.equal(h.sockets.filter((socket) => !socket.closed).length, 1)
  assert.equal(h.sockets.length, 1)
})

test('with no host the frame keeps its sample data and keeps looking', async () => {
  const h = harness([null, null])
  h.connection.start()
  await settle()

  assert.equal(h.state().link, 'none')
  assert.equal(h.sockets.length, 0)
  assert.equal(h.timers.length, 1)

  h.timers.shift()!.run()
  await settle()
  assert.equal(h.state().link, 'none', 'a host that was never there is not a lost one')

  h.connection.stop()
  h.timers.shift()!.run()
  await settle()
  assert.equal(h.timers.length, 0, 'a stopped connection stops looking')
})

test('the question hobkin is asking is held until it is answered, put off, or the host goes away', () => {
  const question = { id: 'q1', from: 'hobkin', question: 'Ship it?', choices: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], other: true, askedAt: 1, expiresAt: 30001 }
  let state = applyHostMessage(initialHostState, hello('/home/one'))
  assert.equal(state.question, null)

  state = applyHostMessage(state, { type: 'ask', question })
  assert.deepEqual(state.question, question)
  // State moving on leaves the question alone.
  state = applyHostMessage(state, everything(1, false, []))
  assert.deepEqual(state.question, question)
  assert.equal(applyHostMessage(state, { type: 'ask', question: null }).question, null)

  // A host that went away is not waiting for this answer any more. A new one says what it is asking.
  assert.equal(applyLink(state, 'lost').question, null)
  assert.equal(applyHostMessage(state, hello('/home/one')).question, null)
})
