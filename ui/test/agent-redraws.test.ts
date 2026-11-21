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
const { useAgents, useRunningCount } = await import('../src/lib/host/hooks.ts')
const { useAgent, useAgentWords, useRunningAgents } = await import('../src/app/running-agents.ts')
const { useHomeModel } = await import('../src/features/home/use-home.ts')
const { useMainChildren, useRunChildren } = await import('../src/features/work/children.ts')
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

  const { needs, week, upcoming } = model!
  await mounted.change(() => send(step('other', { id: 'tool:2', kind: 'tool', name: 'read', state: 'running', input: '{"path":"a.ts"}' })))
  assert.equal(draws, before + 1)
  assert.deepEqual(model!.running.rows.map(({ detail }) => detail), ['running bash', 'running read'])
  assert.ok(model!.needs === needs && model!.week === week && model!.upcoming === upcoming, 'what Home shows apart from its agents is not made again for an agent')
  await mounted.unmount()
})

test('a helper that moves draws the helpers of its own run again, not those of every other run', async () => {
  const helper = (name: string, state: 'running' | 'reported', activeTool = 'bash') => ({ id: name, name, state, activeTool })
  const children = (worker: ReturnType<typeof helper>) => ({ type: 'state' as const, rev: rev++, set: {
    jobChildren: { worker: [worker], other: [helper('other-helper', 'running')] },
    mainChildren: [helper('main-helper', 'running', 'read')],
  } })
  send(children(helper('worker-helper', 'running')))
  const draws = { worker: 0, other: 0, main: 0 }
  const Run = ({ id }: { id: 'worker' | 'other' }) => {
    draws[id] += 1
    useRunChildren(id)
    return null
  }
  const Main = () => {
    draws.main += 1
    useMainChildren()
    return null
  }
  const mounted = await mountCounting(() => [createElement(Run, { key: 'worker', id: 'worker' }), createElement(Run, { key: 'other', id: 'other' }), createElement(Main, { key: 'main' })])

  await mounted.change(() => send(children(helper('worker-helper', 'running', 'read'))))
  assert.deepEqual(draws, { worker: 2, other: 1, main: 1 })
  await mounted.change(() => send(children(helper('worker-helper', 'reported'))))
  assert.deepEqual(draws, { worker: 3, other: 1, main: 1 })
  await mounted.unmount()
})

test('100 rows and five list readers build the agents list once for a message', async () => {
  const ids = Array.from({ length: 100 }, (_, index) => `agent-${index}`)
  const runs = ids.map((id) => ({ id, kind: 'background' as const, state: 'running', title: `Agent ${id}`, cwd: '/fake/app' }))
  // Building the agents list filters the runs, so a spy on the runs' own filter counts the builds.
  let builds = 0
  const filter = runs.filter
  Object.defineProperty(runs, 'filter', { value: (...args: Parameters<typeof filter>) => ((builds += 1), filter.apply(runs, args)) })
  send({ type: 'state', rev: rev++, reset: true, set: { runs, reports: [] }, activity: ids.map((job) => ({ op: 'reset', job, entries: [{ id: 'message:1:0', kind: 'assistant', text: 'Starting' }] })) })

  const said: Record<string, string | undefined> = {}
  const Row = ({ id }: { id: string }) => {
    said[id] = useAgentWords({ id })
    return null
  }
  const readers = [useRunningAgents, useRunningAgents, useAgents, useRunningCount, () => useAgent('agent-7')].map((read, index) =>
    createElement(() => {
      read()
      return null
    }, { key: `reader-${index}` }),
  )
  const mounted = await mountCounting(() => [...ids.map((id) => createElement(Row, { key: id, id })), ...readers])

  builds = 0
  await mounted.change(() => send(words('agent-3', 'Reading the index.')))
  assert.equal(builds, 1, 'one build for a message of words')
  assert.equal(said['agent-3'], 'Reading the index.')

  builds = 0
  await mounted.change(() => send(step('agent-7', { id: 'tool:1', kind: 'tool', name: 'bash', state: 'running', input: '{"command":"ls"}' })))
  assert.equal(builds, 1, 'one build for a message that changes what an agent does, which the list readers draw')
  await mounted.unmount()
})
