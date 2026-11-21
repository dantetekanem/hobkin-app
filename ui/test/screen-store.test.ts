import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from 'zustand/vanilla'
import { mirrorStore, type Pace } from '../src/lib/host/mirror.ts'

/** A host store that takes numbered messages, a page with frames and timers on a made-up clock, and a mirror of it. */
function page() {
  const host = createStore<{ received: number[] }>(() => ({ received: [] }))
  const receive = (n: number) => host.setState(({ received }) => ({ received: [...received, n] }))
  let now = 0
  let hidden = false
  let frames: (() => void)[] = []
  let timers: { at: number; then: () => void }[] = []
  const pace: Pace = {
    frame: (then) => void frames.push(then),
    timer: (then, ms) => void timers.push({ at: now + ms, then }),
    now: () => now,
    hidden: () => hidden,
  }
  /** Moves the clock on, running each timer due on the way and, when the page shows, each frame every 16 ms. */
  const pass = (ms: number) => {
    const end = now + ms
    while (now < end) {
      now = Math.min(end, now + 1)
      for (const timer of timers.filter(({ at }) => at <= now)) {
        timers = timers.filter((each) => each !== timer)
        timer.then()
      }
      if (now % 16 === 0 && !hidden) for (const then of frames.splice(0)) then()
    }
  }
  const hide = (value: boolean) => {
    hidden = value
    if (!value) frames = []
  }
  return { host, receive, pace, pass, hide }
}

/** What a reader of the mirror draws: the state after each change, as React would draw it. */
function drawn<State>(store: { subscribe: (listener: (state: State) => void) => () => void }) {
  const states: State[] = []
  store.subscribe((state) => void states.push(state))
  return states
}

test('messages in one frame draw once, a hidden page draws none, and showing it draws the latest', () => {
  const { host, receive, pace, pass, hide } = page()
  const screen = mirrorStore(host, pace, 'frame')
  const draws = drawn(screen.store)

  for (let n = 1; n <= 3; n++) receive(n)
  assert.equal(draws.length, 0, 'nothing draws before the frame')
  pass(16)
  assert.deepEqual(draws.map(({ received }) => received), [[1, 2, 3]], 'three messages, one draw')

  hide(true)
  for (let n = 4; n <= 40; n++) {
    receive(n)
    pass(25)
  }
  assert.equal(draws.length, 1, 'a hidden page draws nothing, frames or no frames')
  assert.deepEqual(host.getState().received.at(-1), 40, 'the host store took every message')

  hide(false)
  screen.show()
  assert.equal(draws.length, 2, 'showing draws at once')
  assert.equal(screen.store.getState(), host.getState(), 'and draws the latest')
  pass(100)
  assert.equal(draws.length, 2, 'and nothing again until a message')

  // No message is lost and none is applied twice: the mirror draws the host's own state.
  assert.deepEqual(screen.store.getState().received, Array.from({ length: 40 }, (_, index) => index + 1))
})

test('a page that gets no frames draws within a tenth of a second', () => {
  const { host, receive, pace, pass } = page()
  const screen = mirrorStore(host, { ...pace, frame: () => {} }, 'frame')
  const draws = drawn(screen.store)
  receive(1)
  pass(99)
  assert.equal(draws.length, 0)
  pass(1)
  assert.equal(draws.length, 1)
})

test('a list of agents takes the screen at most once every 200 ms, and its last change within 200 ms', () => {
  const { host, receive, pace, pass, hide } = page()
  const screen = mirrorStore(host, pace, 'frame')
  const list = mirrorStore(screen.store, pace, 200)
  const draws: number[] = []
  list.store.subscribe(() => void draws.push(pace.now()))

  for (let n = 1; n <= 40; n++) {
    receive(n)
    pass(25)
  }
  assert.ok(draws.length >= 5 && draws.length <= 6, `${draws.length} draws in a second`)
  assert.ok(draws.every((at, index) => index === 0 || at - draws[index - 1]! >= 200), `draws at ${draws.join(', ')}`)
  assert.equal(draws[0], 16, 'the first change draws with its frame')
  pass(200)
  assert.equal(list.store.getState(), host.getState(), 'the last message reaches the list')

  // Hidden, the list waits too, and it draws the latest once the page shows.
  hide(true)
  receive(41)
  pass(400)
  const before = draws.length
  hide(false)
  screen.show()
  list.show()
  assert.equal(draws.length, before + 1)
  assert.equal(list.store.getState(), host.getState())
})
