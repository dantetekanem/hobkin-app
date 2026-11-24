import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import { registerHooks } from 'node:module'
import { GITHUB_UNKNOWN, sampleGitHub } from '../../shared/protocol/github.ts'
import type { HostMessage } from '../../shared/protocol/messages.ts'
import type { WireSnapshot } from '../../shared/protocol/snapshot.ts'
import type { WorkState } from '../../shared/protocol/work.ts'
import { githubHome } from '../../integrations/github/window/home.ts'
import { applyHostMessage, applyLink, initialHostState } from '../src/lib/host/state.ts'

Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
} })
// The app's `@/` imports point at ui/src, as Vite resolves them.
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
const { HostConnection } = await import('../src/lib/host/connection.ts')
mock.method(HostConnection.prototype, 'start', () => { throw new Error('Connection must stay stopped') })
mock.method(HostConnection.prototype, 'command', async () => { throw new Error('Home must not send commands') })
const { hostStore } = await import('../src/lib/host/client.ts')
const { useReports } = await import('../src/features/reports/store.ts')
const { useActionItems } = await import('../src/features/actions/store.ts')
const { useRoutines } = await import('../src/features/routines/store.ts')
const { gatherHomeInput } = await import('../src/features/home/input.ts')
const { setWindowParts } = await import('../src/integration/registry.ts')
// A part that reads gh as GitHub's does, so Home's input holds what an integration adds to it.
setWindowParts([{ manifest: { id: 'github', name: 'GitHub', line: '', commands: {}, screens: [] }, unknown: GITHUB_UNKNOWN, sample: () => sampleGitHub(1000), home: githubHome }])
after(() => {
  mock.restoreAll()
  mock.timers.reset()
  Reflect.deleteProperty(globalThis, 'window')
})
const gather = () => gatherHomeInput(1000, hostStore.getState(), useReports.getState(), useActionItems.getState(), useRoutines.getState())
const send = (message: HostMessage) => hostStore.setState((state) => applyHostMessage(state, message), true)
const hello = (home: string) => send({
  type: 'hello',
  protocol: 1,
  home,
  model: 'live',
  owner: { state: 'live', limits: { images: 0, imageBytes: 0 } },
  signIn: { status: 'unknown' },
  models: null,
  viewState: null,
})
const reset = (set: WireSnapshot = {}) => send({ type: 'state', rev: 1, reset: true, set })
const unavailable = () => {
  const input = gather()
  assert.equal(input.live, false)
  for (const key of ['reports', 'waiting', 'routines', 'agents'] as const) assert.deepEqual(input[key], [])
  for (const key of ['question', 'work', 'attention', 'wins'] as const) assert.equal(input[key], null)
  assert.deepEqual(input.contributions, [])
  assert.equal(input.read.size, 0)
}

test('no host, sample stores and first hello are not real publication', () => {
  hostStore.setState(initialHostState, true)
  unavailable()
  hostStore.setState((state) => applyLink(state, 'none'), true)
  unavailable()
  hello('/fake/A')
  unavailable()
  reset()
  assert.equal(gather().live, true, 'an actual empty reset is accepted')
  assert.deepEqual(gather().routines, [])
})

test('new-home hello masks retained A facts until B publishes; same-home loss keeps accepted facts', () => {
  hello('/fake/A')
  const github = { ...GITHUB_UNKNOWN, connection: 'connected' as const, login: 'actual' }
  send({ type: 'state', rev: 1, reset: true, set: {
    reports: [{
      id: 'A-report',
      title: 'Actual',
      body: 'Done',
      outcome: 'completed',
      at: '2026-01-01T00:00:00Z',
      readState: 'read',
    }],
    reportAttention: { lastLookAt: '2026-01-01T00:00:00Z' },
    reminderOccurrences: { home: '/fake/A', entries: [] },
    wins: { today: { merged: 1, decided: 0 }, streak: 1 },
  }, slices: { github } })
  const before = gather()

  assert.equal(before.reports[0]?.id, 'A-report')
  assert.equal(before.contributions[0]?.tile?.note, '@actual')
  assert.equal(before.read.has('A-report'), true)
  assert.deepEqual(before.reminders, { home: '/fake/A', entries: [] })
  const question = {
    id: 'ask',
    from: 'hobkin',
    question: 'Which?',
    choices: [],
    other: true,
    askedAt: 1000,
    expiresAt: null,
  }

  send({ type: 'ask', question })
  assert.equal(gather().question, question)
  hostStore.setState((state) => applyLink(state, 'lost'), true)

  assert.deepEqual(gather(), before)
  hello('/fake/B')
  assert.equal(hostStore.getState().slices.github, github, 'reducer still retains A before reset')
  unavailable()
  reset()
  const after = gather()

  assert.equal(after.live, true)
  assert.deepEqual(after.reports, [])
  assert.equal(after.work, null)
  assert.equal(after.attention, undefined)
  assert.equal(after.reminders, undefined)
  assert.equal(after.wins, undefined)
  assert.deepEqual(after.contributions, [{ known: false }])
})

test('sample sources stay excluded and epoch resets recompute even with identical field references', () => {
  reset()
  useReports.setState({ sample: true })
  unavailable()
  useReports.setState({ sample: false })
  useActionItems.setState({ sample: true })
  useRoutines.setState({ sample: 'full' })
  hostStore.setState({ slices: { github: sampleGitHub(1000) } })
  const input = gather()
  assert.deepEqual(input.waiting, [])
  assert.deepEqual(input.routines, [])
  assert.deepEqual(input.contributions, [{ known: false }])
  const reports = [{ id: 'same-reference', title: 'Actual', body: 'Done', outcome: 'completed' }]
  reset({ reports })
  assert.equal(gather().reports[0]?.id, 'same-reference')
  const epoch = hostStore.getState().epoch
  useReports.setState({ ready: false })
  reset({ reports })
  assert.equal(hostStore.getState().epoch, epoch + 1)
  assert.equal(gather().live, true)
  assert.equal(gather().reports[0]?.id, 'same-reference')
})

test('accepted publications gather only actual runs, work and local source facts without changing read history', () => {
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

  send({ type: 'state', rev: 1, reset: true, work, set: {
    waiting: { asks: [{ slug: 'app', item: 'prop', kind: 'proposal', question: 'Pick a path' }] },
    runs: [
      { id: 'worker', kind: 'background', state: 'running', title: 'Working' },
      { id: 'ended', kind: 'background', state: 'completed', title: 'Done' },
      { id: 'main', kind: 'main', state: 'running', title: 'Chat' },
    ],
    schedules: [{
      id: 'check',
      title: 'Check',
      timezone: 'UTC',
      effort: 'medium',
      cwd: '/fake',
      path: '/fake/check',
      prompt: 'Check',
      enabled: true,
      harness: 'pi',
      model: null,
      context: [],
      cadence: 'daily',
      at: '12:00',
    }],
  } })
  const read = useReports.getState().inbox.read
  const input = gather()
  assert.equal(input.work, work)
  assert.deepEqual(input.agents.map(({ id }) => id), ['worker'])
  assert.deepEqual(input.waiting.map(({ id }) => id), ['waiting:asks:app:prop'])
  assert.deepEqual(input.routines.map(({ routine }) => routine.id), ['check'])
  assert.equal(useReports.getState().inbox.read, read)
  useActionItems.setState({ sample: true })
  useRoutines.setState({ sample: 'full' })
  assert.deepEqual(gather().waiting, [])
  assert.deepEqual(gather().routines, [])
  useActionItems.setState({ sample: false, answering: ['waiting:asks:app:prop'] })
  assert.deepEqual(gather().waiting, [])
})
