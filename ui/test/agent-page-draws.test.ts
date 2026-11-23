import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { after, mock, test } from 'node:test'
import { createElement } from 'react'
import type { ActivityEntry, ActivityStep } from '../../shared/protocol/activity.ts'
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
const { useActivityPresence, useAgentActivity, useAgentGlance, useAgentTasks, useStepsMood } = await import('../src/features/agent-activity/use-agent-activity.ts')
const { useMainHead, useMainSteps, useMainTasks } = await import('../src/features/main-agent/main-steps.ts')
after(() => {
  mock.restoreAll()
  mock.timers.reset()
  Reflect.deleteProperty(globalThis, 'window')
})

let rev = 1
const send = (message: HostMessage) => hostStore.setState((state) => applyHostMessage(state, message), true)
const steps = (...activity: ActivityStep[]): HostMessage => ({ type: 'state', rev: rev++, activity })
const update = (entry: ActivityEntry, job = 'worker'): ActivityStep => ({ op: 'update', job, entry })
const printed = (id: string, add: string, job = 'worker'): ActivityStep => ({ op: 'extend', job, id, field: 'output', add })
const bash = (id: string, command: string, state: ActivityEntry['state'] = 'running'): ActivityEntry => ({ id: `tool:${id}`, kind: 'tool', name: 'bash', state, input: JSON.stringify({ command }), output: '' })
const task = (id: string, title: string): ActivityEntry => ({ id: `tool:task${id}`, kind: 'tool', name: 'task_create', state: 'completed', input: JSON.stringify({ subject: title, description: '...' }), output: `Task #${id} created successfully: ${title}` })
const MAIN = '#main'
const opening = (): ActivityEntry[] => [{ id: 'message:1:0', kind: 'assistant', text: 'Starting' }, task('1', 'Fix the tests'), bash('1', 'pnpm test')]

send({ type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: null, viewState: null, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, signIn: { status: 'signed-in' } })
send({
  type: 'state', rev: rev++, reset: true,
  set: { runs: [{ id: 'worker', kind: 'background', state: 'running', title: 'Agent worker', cwd: '/fake/app' }], reports: [], busy: true },
  activity: [{ op: 'reset', job: 'worker', entries: opening() }, { op: 'reset', job: MAIN, entries: opening() }],
})

/** The parts of an agent's page, each reading what it shows of the agent's activity as the page does, counting its draws. */
async function page() {
  const draws = { page: 0, overview: 0, tasks: 0, steps: 0 }
  const read = { glance: undefined as ReturnType<typeof useAgentGlance> | undefined, tasks: [] as ReturnType<typeof useAgentTasks> }
  const Page = () => {
    draws.page += 1
    useActivityPresence('worker')
    return null
  }
  // The overview is hidden behind the steps while they are read.
  const Overview = ({ hidden }: { hidden: boolean }) => {
    draws.overview += 1
    read.glance = useAgentGlance('worker', hidden)
    return null
  }
  const Tasks = () => {
    draws.tasks += 1
    read.tasks = useAgentTasks('worker')
    return null
  }
  const Steps = () => {
    draws.steps += 1
    useAgentActivity('worker')
    return null
  }
  const mounted = await mountCounting(() => [createElement(Page, { key: 'page' }), createElement(Overview, { key: 'overview', hidden: true }), createElement(Tasks, { key: 'tasks' }), createElement(Steps, { key: 'steps' })])
  return { mounted, draws, read }
}

test('ten updates to a running command draw the steps ten times and nothing else of the page', async () => {
  const { mounted, draws, read } = await page()
  assert.deepEqual(draws, { page: 1, overview: 1, tasks: 1, steps: 1 })
  assert.deepEqual(read.tasks.map(({ title }) => title), ['Fix the tests'])

  for (let index = 0; index < 9; index++) await mounted.change(() => send(steps(printed('tool:1', `line ${index}\n`))))
  await mounted.change(() => send(steps(update(bash('2', 'pnpm lint')))))
  assert.deepEqual(draws, { page: 1, overview: 1, tasks: 1, steps: 11 }, 'the page, its hidden overview and its tasks draw nothing for a step')

  // A task the agent adds is something the tasks line shows.
  await mounted.change(() => send(steps(update(task('2', 'Run the lint')))))
  assert.equal(draws.tasks, 2)
  assert.deepEqual(read.tasks.map(({ title }) => title), ['Fix the tests', 'Run the lint'])
  assert.deepEqual([draws.page, draws.overview], [1, 1])
  await mounted.unmount()
})

test('the overview in sight draws when what it says changes, not for a command printing more', async () => {
  const draws = { overview: 0 }
  let glance: ReturnType<typeof useAgentGlance> | undefined
  const Overview = () => {
    draws.overview += 1
    glance = useAgentGlance('worker', false)
    return null
  }
  const mounted = await mountCounting(() => createElement(Overview))
  const shown = glance
  for (let index = 0; index < 5; index++) await mounted.change(() => send(steps(printed('tool:2', `more ${index}\n`))))
  assert.equal(draws.overview, 1, 'the same step count and the same command running')
  assert.equal(glance, shown)

  await mounted.change(() => send(steps(update(bash('3', 'pnpm build')))))
  assert.equal(draws.overview, 2)
  assert.deepEqual(glance?.doing, { lead: 'Running', subject: 'pnpm build', code: true })
  await mounted.unmount()
})

test("a durable hobkin's face draws when the turn's tool starts or ends, not for what it prints", async () => {
  let draws = 0
  let mood: string | undefined
  const Face = () => {
    draws += 1
    mood = useStepsMood('worker')
    return null
  }
  const mounted = await mountCounting(() => createElement(Face))
  assert.equal(mood, 'working')
  for (let index = 0; index < 5; index++) await mounted.change(() => send(steps(printed('tool:3', `built ${index}\n`))))
  assert.equal(draws, 1)
  await mounted.change(() => send(steps(update(bash('3', 'pnpm build', 'completed')))))
  assert.deepEqual([draws, mood], [2, 'thinking'])
  await mounted.unmount()
})

test("ten updates to the main agent's running command draw the mind's steps ten times, and its header and tasks not at all", async () => {
  const draws = { head: 0, tasks: 0, steps: 0 }
  const Head = () => {
    draws.head += 1
    useMainHead()
    return null
  }
  const Tasks = () => {
    draws.tasks += 1
    useMainTasks()
    return null
  }
  const Steps = () => {
    draws.steps += 1
    useMainSteps()
    return null
  }
  const mounted = await mountCounting(() => [createElement(Head, { key: 'head' }), createElement(Tasks, { key: 'tasks' }), createElement(Steps, { key: 'steps' })])
  for (let index = 0; index < 10; index++) await mounted.change(() => send(steps(printed('tool:1', `line ${index}\n`, MAIN))))
  assert.deepEqual(draws, { head: 1, tasks: 1, steps: 11 })

  // A new step is a new count in the header.
  await mounted.change(() => send(steps(update(bash('2', 'pnpm lint'), MAIN))))
  assert.deepEqual(draws, { head: 2, tasks: 1, steps: 12 })
  await mounted.unmount()
})
