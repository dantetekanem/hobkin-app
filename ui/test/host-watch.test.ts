import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from 'zustand/vanilla'
import type { HelloMessage, HostMessage } from '#shared/protocol/messages.ts'
import { HostConnection, type SocketLike } from '../src/lib/host/connection.ts'
import { applyHostMessage, applyLink, initialHostState, type HostState } from '../src/lib/host/state.ts'
import { followWatching, Watched } from '../src/lib/host/watch.ts'

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  readonly sent: string[] = []
  readonly url: string

  constructor(url: string) {
    this.url = url
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.onclose?.()
  }

  receive(message: HostMessage) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }

  watches() {
    return this.sent.map((text) => JSON.parse(text)).filter((message) => message.type === 'watch').map((message) => message.jobs)
  }
}

const hello = (more: Partial<HelloMessage> = {}): HelloMessage => ({
  type: 'hello',
  protocol: 1,
  home: '/fake/home',
  model: 'scripted',
  owner: { state: 'live', limits: { images: 4, imageBytes: 1024 } },
  signIn: { status: 'signed-in' },
  models: null,
  viewState: null,
  ...more,
})
const settle = () => new Promise((resolve) => setImmediate(resolve))

/** The window's connection, store and watched jobs, wired as `client.ts` wires them, with sockets and timers the test holds. */
function windowWith() {
  const sockets: FakeSocket[] = []
  const retries: (() => void)[] = []
  const store = createStore<HostState>(() => initialHostState)
  const connection = new HostConnection({
    discover: async () => ({ url: 'ws://host.invalid', token: 't' }),
    createSocket: (url) => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    },
    schedule: (run) => void retries.push(run),
    onMessage: (message) => store.setState((state) => applyHostMessage(state, message), true),
    onLink: (link) => store.setState((state) => applyLink(state, link), true),
  })
  const watched = new Watched()
  followWatching(store, watched, (message) => connection.send(message))
  return { sockets, retries, connection, watched }
}

test('a window says what it reads in its address, and a host from before never hears watch', async () => {
  const { sockets, connection, watched } = windowWith()
  connection.start()
  await settle()
  const [socket] = sockets
  assert.equal(new URL(socket!.url).searchParams.get('reads'), 'tails,extend')

  watched.hold('r1')
  socket!.receive(hello())
  watched.hold('r2')
  await settle()
  assert.deepEqual(socket!.watches(), [], 'a hello without watch, from a host that would close on it')
})

test('the window tells a host that takes watching what it watches, as the set changes and again after a reconnect', async () => {
  const { sockets, retries, connection, watched } = windowWith()
  connection.start()
  await settle()
  const release = watched.hold('r1')
  sockets[0]!.receive(hello({ watch: true }))
  watched.hold('r2')
  await settle()
  release()
  await settle()
  watched.hold('r2')()
  await settle()
  assert.deepEqual(sockets[0]!.watches(), [['r1'], ['r1', 'r2'], ['r2']], 'a second hold of a job held already says nothing new')

  sockets[0]!.close()
  retries.shift()!()
  await settle()
  sockets[1]!.receive(hello({ watch: true }))
  assert.deepEqual(sockets[1]!.watches(), [['r2']])
})

test('the holds and lets go made together, as by the pages one draw mounts and unmounts, are one message with the set they leave', async () => {
  const { sockets, connection, watched } = windowWith()
  connection.start()
  await settle()
  sockets[0]!.receive(hello({ watch: true }))
  // A page leaves and the next one comes: its jobs go, and twenty turns come, in one draw.
  const leaving = watched.hold('old')
  await settle()
  leaving()
  const coming = Array.from({ length: 20 }, (_, index) => watched.hold(`turn-${String(index).padStart(2, '0')}`))
  await settle()
  assert.deepEqual(sockets[0]!.watches(), [[], ['old'], coming.map((_, index) => `turn-${String(index).padStart(2, '0')}`)])

  // A job let go and held again in the same draw, as when a page moves, says nothing.
  coming[0]!()
  watched.hold('turn-00')
  await settle()
  assert.equal(sockets[0]!.watches().length, 3)
})
