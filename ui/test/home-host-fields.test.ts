import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import { registerHooks } from 'node:module'
import { shallow } from 'zustand/vanilla/shallow'
import { GITHUB_UNKNOWN } from '../../shared/protocol/github.ts'
import type { WorkState } from '../../shared/protocol/work.ts'
import { applyHostMessage, initialHostState, type HostState } from '../src/lib/host/state.ts'

Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
} })
// The app's `@/` imports point at ui/src, as Vite resolves them.
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
const { HostConnection } = await import('../src/lib/host/connection.ts')
mock.method(HostConnection.prototype, 'start', () => { throw new Error('Connection must stay stopped') })
mock.method(HostConnection.prototype, 'command', async () => { throw new Error('Home must not send commands') })
const { useReports } = await import('../src/features/reports/store.ts')
const { useActionItems } = await import('../src/features/actions/store.ts')
const { useRoutines } = await import('../src/features/routines/store.ts')
const { gatherHomeInput } = await import('../src/features/home/input.ts')
const { agentsFrom } = await import('../src/lib/host/frame.ts')
const { homeHost, homeHostFields } = await import('../src/features/home/use-home.ts')
after(() => {
  mock.restoreAll()
  mock.timers.reset()
  Reflect.deleteProperty(globalThis, 'window')
})

const work: WorkState = {
  enabled: true,
  folder: '/fake',
  autoPick: false,
  held: null,
  forecast: null,
  agents: 1,
  agentsAllowed: 1,
  maxAgents: 1,
  queue: [],
  queued: 0,
  projects: [],
  finished: [],
}

/** A live host with every field set and none at its initial value, so a field Home reads but does not select shows in the result. */
const full: HostState = {
  link: 'open',
  snapshotReady: true,
  home: '/fake/home',
  model: 'live',
  owner: { state: 'live', limits: { images: 4, imageBytes: 1 } },
  signIn: { status: 'signed-in' },
  models: { providers: [], models: [{ id: 'fake-model', provider: 'fake', name: 'Fake', thinking: ['low'], contextWindow: null }] },
  github: { ...GITHUB_UNKNOWN, connection: 'connected', login: 'actual' },
  slices: { github: { ...GITHUB_UNKNOWN, connection: 'connected', login: 'other' } },
  integrations: { path: '~/.pi/agent/mcp.json', servers: [], problems: [], checking: false, checkedAt: '2026-01-01T00:00:00Z', error: null },
  work,
  canvas: { open: true, url: 'https://page.invalid/', title: 'Page' },
  canvases: { durable: { open: false, url: null, title: null } },
  nudge: { id: 1, action: { kind: 'spotlight' } },
  appearance: { id: 1, name: 'Night', palette: { background: '#101014', surface: '#1c1c22', text: '#f4f4f5', muted: '#a1a1aa', accent: '#facc15' } },
  snapshot: {
    // What Home reads.
    runs: [
      { id: 'worker', kind: 'background', state: 'running', title: 'Working', cwd: '/fake/app', effort: 'high' },
      { id: 'main', kind: 'main', state: 'running', title: 'Chat' },
    ],
    jobActivity: { worker: [{ id: 'message:1:0', kind: 'assistant', text: 'Reading the tests' }] },
    reportAttention: { lastLookAt: '2026-01-01T00:00:00Z' },
    reminderOccurrences: { home: '/fake/home', entries: [] },
    wins: { today: { merged: 1, decided: 2 }, streak: 3 },
    homeLayout: { order: ['stack'] },
    homeCustom: [{ id: 'custom' }],
    homeThoughts: [{ id: 'thought' }],
    // What it does not.
    busy: true,
    doing: 'writing',
    mainActivity: [{ id: 'message:2:0', kind: 'assistant', text: 'Hello' }],
    stopControls: { home: '/fake/home', epoch: 'host:1', targets: [] },
  },
  messages: [{ id: 'said', role: 'user', content: 'Hello' }],
  live: { known: ['said'], replies: [{ serial: 0, blocks: ['Hi'], done: false }], opened: 1 },
  question: { id: 'ask', from: 'hobkin', question: 'Which?', choices: [], other: true, askedAt: 1000, expiresAt: null },
  epoch: 3,
}

// Accepted, non-sample sources, so Home reads the host as live.
useReports.setState({ ready: true, sample: false })
useActionItems.setState({ sample: false })
useRoutines.setState({ sample: null })
const gather = (host: HostState, agents?: ReturnType<typeof agentsFrom>) => gatherHomeInput(1000, host, useReports.getState(), useActionItems.getState(), useRoutines.getState(), undefined, agents)

test('Home gathers the same input from the fields it selects, with the agents it keeps, as from the whole host state', () => {
  for (const key of Object.keys(initialHostState) as (keyof HostState)[]) assert.notDeepEqual(full[key], initialHostState[key], `the state sets ${key}`)
  const whole = gather(full)
  assert.equal(whole.live, true)
  assert.deepEqual(whole.agents.map(({ id, update }) => [id, update]), [['worker', 'Reading the tests']])

  assert.deepEqual(gather(homeHost(homeHostFields(full)), agentsFrom(full.snapshot)), whole)
})

test('a message that changes nothing Home reads leaves its selection as it was, and one that does changes it', () => {
  const selected = homeHostFields(full)
  const word = applyHostMessage(full, { type: 'turn', seq: 1, event: { kind: 'message-start', role: 'assistant' } })
  const busy = applyHostMessage(full, { type: 'state', rev: 2, set: { busy: false, doing: 'thinking' } })
  // Home's agents come from `useAgents`, so an agent's steps leave the fields alone (ui/test/agent-redraws.test.ts).
  const step = applyHostMessage(full, { type: 'state', rev: 2, activity: [{ op: 'update', job: 'worker', entry: { id: 'message:1:0', kind: 'assistant', text: 'Reading more' } }] })
  assert.notEqual(word.live, full.live)
  assert.notEqual(busy.snapshot, full.snapshot)
  assert.equal(shallow(homeHostFields(word), selected), true)
  assert.equal(shallow(homeHostFields(busy), selected), true)
  assert.equal(shallow(homeHostFields(step), selected), true)

  const won = applyHostMessage(full, { type: 'state', rev: 3, set: { wins: { today: { merged: 2, decided: 2 }, streak: 3 } } })
  assert.equal(shallow(homeHostFields(won), selected), false)
})
