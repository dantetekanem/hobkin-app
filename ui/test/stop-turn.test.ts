import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from 'zustand/vanilla'
import type { HostMessage } from '../../shared/protocol/messages.ts'
import type { StopControlTarget } from '../../shared/protocol/snapshot.ts'
import { canStopConversation } from '../src/features/chat/availability.ts'
import { armedAt, shownTurn } from '../src/features/chat/stop-turn.ts'
import { mirrorStore } from '../src/lib/host/mirror.ts'
import { applyHostMessage, initialHostState, type HostState } from '../src/lib/host/state.ts'

const hello: HostMessage = { type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: null, viewState: null, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, signIn: { status: 'signed-in' } }
const turn = (runId: string): StopControlTarget => ({ kind: 'main', runId, parentId: null, rootId: runId, label: 'Main conversation', canStop: true, canForce: true })
const controls = (rev: number, ...targets: StopControlTarget[]): HostMessage => ({ type: 'state', rev, set: { stopControls: { home: '/fake/home', epoch: 'e1', targets } } })

test('a stop armed during one turn is not armed for a queued turn that starts within the same frame', () => {
  const host = createStore<HostState>(() => [hello, controls(1, turn('turn:A'))].reduce(applyHostMessage, initialHostState))
  const receive = (message: HostMessage) => host.setState((state) => applyHostMessage(state, message), true)
  const frames: (() => void)[] = []
  const screen = mirrorStore(host, { frame: (then) => void frames.push(then), timer: () => {}, now: () => 0, hidden: () => false }, 'frame')
  const nextFrame = () => {
    for (const then of frames.splice(0)) then()
  }
  assert.equal(shownTurn(screen.store.getState()), 'turn:A')
  const armed = { at: 1_000, turn: 'turn:A' }

  // Turn A ends and the queued turn B starts before the next frame.
  receive(controls(2))
  receive(controls(3, turn('turn:B')))
  nextFrame()

  const shown = screen.store.getState()
  assert.equal(canStopConversation(shown), true, 'the screen never shows the turn ending, so nothing that waits for that can disarm')
  assert.equal(armedAt(armed, shownTurn(shown)), null, 'the stop armed for turn A is not armed for turn B')
  assert.equal(armedAt(armed, 'turn:A'), 1_000, 'while turn A runs it stays armed')
  screen.stop()
})
