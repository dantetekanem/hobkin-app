import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { after, mock, test } from 'node:test'
import { createElement } from 'react'
import type { HostMessage } from '../../shared/protocol/messages.ts'
import type { TeamsAgent } from '../../shared/protocol/teams.ts'
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
const { useDrop } = await import('../src/features/agent-activity/drop.ts')
const { useTeamsAgents } = await import('../src/features/teams/use-teams-agents.ts')
after(() => {
  mock.restoreAll()
  mock.timers.reset()
  Reflect.deleteProperty(globalThis, 'window')
})

let rev = 1
const send = (message: HostMessage) => hostStore.setState((state) => applyHostMessage(state, message), true)
const scout = (state: TeamsAgent['state']): TeamsAgent => ({ key: 'call:scout', name: 'scout', task: 'Find the bug', state, startedAt: 1, from: 'run', ...(state === 'done' ? { endedAt: 2 } : {}) })
const agents = (state: TeamsAgent['state']): HostMessage => ({ type: 'state', rev: rev++, set: { teamsAgents: { worker: [scout(state)] } } })

send({ type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: null, viewState: null, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, signIn: { status: 'signed-in' } })
send({ type: 'state', rev: rev++, reset: true, set: { runs: [{ id: 'worker', kind: 'background', state: 'running', title: 'Agent worker', cwd: '/fake/app' }], reports: [] } })

test("the line's last agent stays in its open list once it finishes, marked done, and leaves when the list closes", async () => {
  let shown: readonly TeamsAgent[] = []
  const Probe = () => {
    shown = useTeamsAgents(['worker'], { list: useDrop((state) => state.open === 'agents') })
    return null
  }
  const mounted = await mountCounting(() => createElement(Probe))
  const states = () => shown.map((agent) => `${agent.name}:${agent.state}`)

  await mounted.change(() => send(agents('running')))
  assert.deepEqual(states(), ['scout:running'])
  await mounted.change(() => useDrop.getState().setOpen('agents', true))
  await mounted.change(() => send(agents('done')))
  assert.deepEqual(states(), ['scout:done'], 'what the user is reading does not vanish under them')
  await mounted.change(() => useDrop.getState().setOpen('agents', false))
  assert.deepEqual(states(), [], 'closed, a done agent leaves')
  await mounted.unmount()
})
