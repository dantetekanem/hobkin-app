import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import { createElement } from 'react'
import type { HostMessage } from '../../shared/protocol/messages.ts'
import type { RunPulse } from '../../shared/protocol/pulse.ts'
import { applyHostMessage } from '../src/lib/host/state.ts'
import { mountCounting } from './render-count.ts'
import { readViews } from './view-draws.ts'

Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
} })
readViews()
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
const { HostConnection } = await import('../src/lib/host/connection.ts')
mock.method(HostConnection.prototype, 'start', () => { throw new Error('Connection must stay stopped') })
mock.method(HostConnection.prototype, 'command', async () => { throw new Error('Nothing here sends commands') })
const { hostStore } = await import('../src/lib/host/client.ts')
const { usePulse } = await import('../src/features/pulse/Pulse.tsx')
after(() => {
  mock.restoreAll()
  mock.timers.reset()
  Reflect.deleteProperty(globalThis, 'window')
})

let rev = 1
const send = (message: HostMessage) => hostStore.setState((state) => applyHostMessage(state, message), true)
const pulse = (tokens: number): RunPulse => ({ startedAt: 1_000, lastTokenAt: 1_000 + tokens, phase: 'working', direction: 'down', tokens })
// The host sends every run's pulse anew with each publish, as parsed JSON: no object in it is one the window holds.
const pulses = (a: number, b: number): HostMessage => ({ type: 'state', rev: rev++, set: { pulses: { a: pulse(a), b: pulse(b) } } })

send({ type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: null, viewState: null, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, signIn: { status: 'signed-in' } })
send({ type: 'state', rev: rev++, reset: true, set: { runs: [] } })

test("one run's pulse moving draws its own working line, not another run's", async () => {
  send(pulses(10, 500))
  const draws = { a: 0, b: 0 }
  const seen: Record<string, RunPulse | null> = {}
  const Line = ({ run }: { run: 'a' | 'b' }) => {
    draws[run] += 1
    seen[run] = usePulse(run)
    return null
  }
  const mounted = await mountCounting(() => [createElement(Line, { key: 'a', run: 'a' }), createElement(Line, { key: 'b', run: 'b' })])
  assert.deepEqual(draws, { a: 1, b: 1 })

  const messages = 10
  for (let index = 1; index <= messages; index++) await mounted.change(() => send(pulses(10 + index * 100, 500)))
  assert.equal(draws.a, 1 + messages, "run A's line draws each time its tokens move")
  assert.equal(seen.a?.tokens, 10 + messages * 100)
  assert.equal(draws.b, 1, "run B's pulse said the same each time, so its line drew none")
  await mounted.unmount()
})
