import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { after, mock, test } from 'node:test'
import { createElement } from 'react'
import type { HostMessage } from '../../shared/protocol/messages.ts'
import type { RunChild } from '../../shared/protocol/snapshot.ts'
import type { TeamsAgent } from '../../shared/protocol/teams.ts'
import type { ActivityAgent } from '../src/features/teams/activity.ts'
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
const { openNavigator, useNavigator, useSubagents } = await import('../src/features/teams/use-activity.ts')
after(() => {
  mock.restoreAll()
  mock.timers.reset()
  Reflect.deleteProperty(globalThis, 'window')
})

let rev = 1
const send = (message: HostMessage) => hostStore.setState((state) => applyHostMessage(state, message), true)
const scout = (state: TeamsAgent['state']): TeamsAgent => ({ key: 'call:scout', name: 'scout', task: 'Find the bug', state, startedAt: 1, from: 'run', ...(state === 'done' ? { endedAt: 2 } : {}) })
const reader = (state: RunChild['state']): RunChild => ({ id: 'h1', name: 'reader', state })
const agents = (teams: TeamsAgent['state'], helper: RunChild['state']): HostMessage => ({
  type: 'state', rev: rev++, set: { teamsAgents: { worker: [scout(teams)] }, jobChildren: { worker: [reader(helper)] } },
})

send({ type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: null, viewState: null, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, signIn: { status: 'signed-in' } })
send({ type: 'state', rev: rev++, reset: true, set: { runs: [{ id: 'worker', kind: 'background', state: 'running', title: 'Agent worker', cwd: '/fake/app' }], reports: [] } })

test('an agent the navigator shows stays in it once it finishes, marked as it ended, and leaves when the navigator closes', async () => {
  let shown: readonly ActivityAgent[] = []
  const Probe = () => {
    shown = useSubagents('worker', useNavigator((state) => state.open?.agent === 'worker'))
    return null
  }
  const mounted = await mountCounting(() => createElement(Probe))
  const states = () => shown.map((agent) => (agent.kind === 'teams' ? `teams:${agent.teams.name}:${agent.teams.state}` : `helper:${agent.helper.name}:${agent.helper.state}`))

  await mounted.change(() => send(agents('running', 'running')))
  assert.deepEqual(states(), ['teams:scout:running', 'helper:reader:running'])
  await mounted.change(() => useNavigator.setState({ open: { agent: 'worker', at: shown[0]!.id, from: null, side: null } }))
  await mounted.change(() => send(agents('done', 'reported')))
  assert.deepEqual(states(), ['teams:scout:done', 'helper:reader:reported'], 'what the user is reading does not vanish under them')
  await mounted.change(() => useNavigator.setState({ open: null }))
  assert.deepEqual(states(), [], 'closed, those that ended leave')
  await mounted.unmount()
})

test('Down opens the navigator only over an agent whose strip draws agents, on the first or the one asked for', () => {
  useNavigator.setState({ open: null, rows: { worker: ['teams:a', 'helper:b'], idle: [] } })
  assert.equal(openNavigator('idle'), false)
  assert.equal(openNavigator('elsewhere'), false)
  assert.equal(useNavigator.getState().open, null, 'nothing opens, so the key does what it did before')
  assert.equal(openNavigator('worker'), true)
  assert.deepEqual(useNavigator.getState().open, { agent: 'worker', at: 'teams:a', from: null, side: null }, 'with no window, no right side to open over')
  assert.equal(openNavigator('worker', { at: 'helper:b' }), true)
  assert.equal(useNavigator.getState().open?.at, 'helper:b')
  assert.equal(openNavigator('worker', { at: 'gone' }), true)
  assert.equal(useNavigator.getState().open?.at, 'teams:a', 'one no longer drawn opens on the first')
  useNavigator.setState({ open: null, rows: {} })
})
