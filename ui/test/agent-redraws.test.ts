import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { after, mock, test } from 'node:test'
import { createElement } from 'react'
import type { ActivityEntry } from '../../shared/protocol/activity.ts'
import type { HostMessage } from '../../shared/protocol/messages.ts'
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
const { useAgents } = await import('../src/lib/host/hooks.ts')
const { useHomeModel } = await import('../src/features/home/use-home.ts')
const { useReports } = await import('../src/features/reports/store.ts')
after(() => {
  mock.restoreAll()
  mock.timers.reset()
  Reflect.deleteProperty(globalThis, 'window')
})

let rev = 1
const send = (message: HostMessage) => hostStore.setState((state) => applyHostMessage(state, message), true)
const step = (job: string, entry: ActivityEntry): HostMessage => ({ type: 'state', rev: rev++, activity: [{ op: 'update', job, entry }] })
const words = (job: string, text: string) => step(job, { id: 'message:1:0', kind: 'assistant', text })

send({ type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: null, viewState: null, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, signIn: { status: 'signed-in' } })
send({
  type: 'state', rev: rev++, reset: true,
  set: { runs: ['worker', 'other'].map((id) => ({ id, kind: 'background', state: 'running', title: `Agent ${id}`, cwd: '/fake/app' })), reports: [] },
  activity: ['worker', 'other'].map((job) => ({ op: 'reset', job, entries: [{ id: 'message:1:0', kind: 'assistant', text: 'Starting' }] })),
})

/** Ten messages in which agents only say more words, which neither reader draws. Each one is drawn on its own, as the window does. */
async function chatter(mounted: { change: (run: () => void) => Promise<void> }) {
  for (let index = 0; index < 5; index++) {
    await mounted.change(() => send(words('worker', `Reading file ${index}`)))
    await mounted.change(() => send(words('other', `Thinking about ${index}`)))
  }
}

test('agents that only say more words do not draw the agents list again, and one that starts a tool does', async () => {
  let draws = 0
  const Probe = () => {
    draws += 1
    useAgents()
    return null
  }
  const mounted = await mountCounting(() => createElement(Probe))
  assert.equal(draws, 1)

  await chatter(mounted)
  assert.equal(draws, 1, 'an agent\'s words alone draw nothing')

  await mounted.change(() => send(step('worker', { id: 'tool:1', kind: 'tool', name: 'bash', state: 'running', input: '{"command":"ls"}' })))
  assert.equal(draws, 2, 'a tool starting changes what the agent is doing')
  await mounted.unmount()
})

test('Home draws again when what it shows of an agent changes, not for every step the agents stream', async () => {
  // Reports have been published, so Home reads the host as live.
  useReports.setState({ ready: true, sample: false })
  let draws = 0
  let model: ReturnType<typeof useHomeModel> | undefined
  const Probe = () => {
    draws += 1
    model = useHomeModel()
    return null
  }
  const mounted = await mountCounting(() => createElement(Probe))
  const before = draws
  // The test above left the worker running a command.
  assert.deepEqual(model!.running.rows.map(({ title, detail }) => [title, detail]), [['Agent worker', 'running bash'], ['Agent other', 'writing']])

  await chatter(mounted)
  assert.equal(draws, before, 'Home does not draw an agent\'s words')

  await mounted.change(() => send(step('other', { id: 'tool:2', kind: 'tool', name: 'read', state: 'running', input: '{"path":"a.ts"}' })))
  assert.equal(draws, before + 1)
  assert.deepEqual(model!.running.rows.map(({ detail }) => detail), ['running bash', 'running read'])
  await mounted.unmount()
})
