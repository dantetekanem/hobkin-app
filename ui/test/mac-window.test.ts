import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HostMessage } from '#shared/protocol/messages.ts'
import { availabilityOf } from '../src/features/chat/availability.ts'
import { connectionFrom, hasHost } from '../src/lib/host/frame.ts'
import { applyHostMessage, applyLink, initialHostState } from '../src/lib/host/state.ts'

const owner = { state: 'live', limits: { images: 4, imageBytes: 67108864 } } as const
const hello: HostMessage = { type: 'hello', protocol: 1, home: '/home', model: 'live', owner, signIn: { status: 'signed-in' }, models: null, viewState: null }
const everything: HostMessage = { type: 'state', rev: 1, reset: true, set: { busy: false }, messages: [{ op: 'reset', messages: [{ id: 'a', role: 'assistant', content: 'Morning.' }] }], owner }
const connected = [hello, everything].reduce(applyHostMessage, initialHostState)
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('the Mac window has a host from the start, so it never draws sample data', () => {
  assert.equal(hasHost(initialHostState, true), true)
  const waiting = { ...initialHostState, link: 'none' } as const
  assert.equal(hasHost(waiting, true), true, 'a host that is slow to answer is still coming')
  assert.deepEqual(
    [connectionFrom(initialHostState, true), connectionFrom({ ...initialHostState, link: 'none' }, true)].map(({ status, label }) => ({ status, label })),
    [{ status: 'connecting', label: 'Connecting…' }, { status: 'connecting', label: 'Connecting…' }],
  )
  assert.deepEqual(availabilityOf(initialHostState, true), { ready: false, reason: 'Connecting to hobkin…' })
})

test('a browser tab keeps its sample data until a host answers', () => {
  assert.equal(hasHost(initialHostState, false), false)
  assert.equal(connectionFrom(initialHostState, false).status, 'sample')
  assert.deepEqual(availabilityOf(initialHostState, false), { ready: false, reason: 'Looking for hobkin.' })
  assert.deepEqual(availabilityOf({ ...initialHostState, link: 'none' }, false), { ready: false, reason: 'This is sample data. Start the host to talk to hobkin.' })
})

test('a dropped connection keeps what the host last sent, says it is reconnecting, and refuses to send', () => {
  for (const macWindow of [true, false]) {
    for (const link of ['lost', 'connecting'] as const) {
      const dropped = applyLink(connected, link)
      assert.equal(dropped.home, '/home')
      assert.equal(dropped.messages, connected.messages)
      assert.equal(dropped.snapshot, connected.snapshot)
      assert.equal(hasHost(dropped, macWindow), true)
      assert.equal(connectionFrom(dropped, macWindow).label, 'Reconnecting…')
      assert.deepEqual(availabilityOf(dropped, macWindow), { ready: false, reason: 'Reconnecting to hobkin. You can send again once it is back.' })
    }
  }
})

test('the window keeps one store when a module of the host folder runs again', async () => {
  const first = await import('../src/lib/host/client.ts')
  // A hot update runs the module again as a new copy, as this query does.
  const again = (await import(new URL('../src/lib/host/client.ts?hot-update', import.meta.url).href)) as typeof first
  assert.equal(again.hostStore, first.hostStore)
})

test('letting go of the connection and taking hold of it again at once keeps it open', async () => {
  let looks = 0
  // No host here: each attempt to connect looks once, finds nothing and tries again a second later.
  ;(globalThis as { __HOBKIN_HOST__?: unknown }).__HOBKIN_HOST__ = () => {
    looks += 1
    return null
  }
  const { startHostConnection } = await import('../src/lib/host/client.ts')
  const letGo = startHostConnection()
  let letGoForGood = letGo
  try {
    await wait(10)
    assert.equal(looks, 1)

    // A hot update re-runs the effect that holds the connection: it lets go and takes hold again in one go.
    letGo()
    letGoForGood = startHostConnection()
    await wait(10)
    assert.equal(looks, 1, 'the connection was not started over')
  } finally {
    letGoForGood()
  }
  await wait(1200)
  assert.equal(looks, 1, 'once nothing holds it, it stops looking')
})
