import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { after, mock, test } from 'node:test'
import { createElement } from 'react'
import type { ActivityEntry, ActivityStep } from '../../shared/protocol/activity.ts'
import type { HostMessage } from '../../shared/protocol/messages.ts'
import type { RunChild, WireSnapshot } from '../../shared/protocol/snapshot.ts'
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
const { agentJobs, useJobsHelpers, useJobsSkills, useJobsTasks } = await import('../src/features/agent-activity/agent-jobs.ts')
after(() => {
  mock.restoreAll()
  mock.timers.reset()
  Reflect.deleteProperty(globalThis, 'window')
})

const HOBKIN = 'abcd1234'
const turn = (n: number) => `hobkin:${HOBKIN}:${n}`
const MAIN = '#main'

let rev = 1
const send = (message: HostMessage) => hostStore.setState((state) => applyHostMessage(state, message), true)
const steps = (...activity: ActivityStep[]): HostMessage => ({ type: 'state', rev: rev++, activity })
const update = (entry: ActivityEntry, job: string): ActivityStep => ({ op: 'update', job, entry })
const printed = (id: string, add: string, job: string): ActivityStep => ({ op: 'extend', job, id, field: 'output', add })
const tool = (id: string, name: string, args: object, output = ''): ActivityEntry => ({ id: `tool:${id}`, kind: 'tool', name, state: 'completed', input: JSON.stringify(args), output })
const created = (id: string, title: string) => tool(`create${id}`, 'task_create', { subject: title, description: '...' }, `Task #${id} created successfully: ${title}`)
const done = (id: string) => tool(`done${id}`, 'task_update', { taskId: id, status: 'completed' }, `Updated task #${id} status`)
const skill = (id: string, name: string) => tool(`skill${id}`, 'load_skill', { name })
const bash = (id: string): ActivityEntry => ({ id: `tool:${id}`, kind: 'tool', name: 'bash', state: 'running', input: JSON.stringify({ command: 'pnpm test' }), output: '' })
const helper = (name: string, state: RunChild['state'] = 'running'): RunChild => ({ id: name, name, state })

send({ type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: null, viewState: null, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, signIn: { status: 'signed-in' } })
send({
  type: 'state', rev: rev++, reset: true,
  set: {
    runs: [{ id: turn(2), kind: 'background', state: 'running', title: 'Change watcher', cwd: '/fake/app' }],
    reports: [],
    jobChildren: { [turn(1)]: [helper('scout', 'reported')], [turn(2)]: [helper('fixer')] },
    mainChildren: [helper('main-scout')],
  },
  activity: [
    { op: 'reset', job: turn(1), entries: [created('1', 'Read the diff'), skill('1', 'humanizer')] },
    { op: 'reset', job: turn(2), entries: [done('1'), created('2', 'Say what changed'), skill('2', 'test-expert'), bash('1')] },
    { op: 'reset', job: MAIN, entries: [created('1', 'Answer the user'), skill('1', 'hobkin')] },
  ],
})

test("an agent's jobs: a run's own, the main agent's, and a durable hobkin's turns the host holds anything of, the one in flight first", () => {
  const snapshot = {
    hobkins: [{ id: HOBKIN, run: turn(5) }],
    jobActivity: { [turn(5)]: [], [turn(2)]: [], 'hobkin:ffff0000:9': [], 'run-1': [] },
    jobChildren: { [turn(3)]: [] },
    teamsAgents: { [turn(11)]: [] },
  } as unknown as WireSnapshot
  assert.deepEqual(agentJobs(snapshot, 'run-1'), ['run-1'])
  assert.deepEqual(agentJobs(snapshot, MAIN), [MAIN])
  // The one in flight first, then the newest: by the turn's number, not as text.
  assert.deepEqual(agentJobs(snapshot, `hobkin:${HOBKIN}`), [turn(5), turn(11), turn(3), turn(2)])
  assert.deepEqual(agentJobs({} as WireSnapshot, `hobkin:${HOBKIN}`), [], 'a hobkin the host holds nothing of')
})

test("a durable hobkin's tasks and skills read across its turns, oldest first, and draw again only when a task or a skill changes", async () => {
  const draws = { tasks: 0, skills: 0 }
  const read = { tasks: [] as ReturnType<typeof useJobsTasks>, skills: [] as ReturnType<typeof useJobsSkills> }
  const jobs = [turn(2), turn(1)]
  const Tasks = () => {
    draws.tasks += 1
    read.tasks = useJobsTasks(jobs)
    return null
  }
  const Skills = () => {
    draws.skills += 1
    read.skills = useJobsSkills(jobs)
    return null
  }
  const mounted = await mountCounting(() => [createElement(Tasks, { key: 'tasks' }), createElement(Skills, { key: 'skills' })])
  // The task made in the first turn is done in the second.
  assert.deepEqual(read.tasks.map(({ id, title, state }) => [id, title, state]), [['1', 'Read the diff', 'done'], ['2', 'Say what changed', 'queued']])
  assert.deepEqual(read.skills, ['humanizer', 'test-expert'])

  for (let index = 0; index < 5; index++) await mounted.change(() => send(steps(printed('tool:1', `line ${index}\n`, turn(2)))))
  assert.deepEqual(draws, { tasks: 1, skills: 1 }, 'a command printing draws neither')

  await mounted.change(() => send(steps(update(done('2'), turn(2)))))
  assert.deepEqual(draws, { tasks: 2, skills: 1 })
  assert.equal(read.tasks.at(-1)?.state, 'done')
  await mounted.unmount()
})

test("the main agent's tasks and skills are its own steps'", async () => {
  const read = { tasks: [] as ReturnType<typeof useJobsTasks>, skills: [] as ReturnType<typeof useJobsSkills> }
  const Lines = () => {
    read.tasks = useJobsTasks([MAIN])
    read.skills = useJobsSkills([MAIN])
    return null
  }
  const mounted = await mountCounting(() => createElement(Lines))
  assert.deepEqual(read.tasks.map(({ title }) => title), ['Answer the user'])
  assert.deepEqual(read.skills, ['hobkin'])
  await mounted.unmount()
})

test("an agent's helpers are every one of its jobs' helpers, the main agent's its own, and they draw again only when one moves", async () => {
  let draws = 0
  let shown: readonly RunChild[] = []
  let main: readonly RunChild[] = []
  const jobs = [turn(2), turn(1)]
  const Helpers = () => {
    draws += 1
    shown = useJobsHelpers(jobs)
    return null
  }
  const Main = () => {
    main = useJobsHelpers([MAIN])
    return null
  }
  const mounted = await mountCounting(() => [createElement(Helpers, { key: 'helpers' }), createElement(Main, { key: 'main' })])
  assert.deepEqual(shown.map(({ name }) => name), ['fixer', 'scout'], 'the turn in flight first')
  assert.deepEqual(main.map(({ name }) => name), ['main-scout'])

  await mounted.change(() => send(steps(printed('tool:1', 'more\n', turn(2)))))
  await mounted.change(() => send({ type: 'state', rev: rev++, set: { jobChildren: { [turn(1)]: [helper('scout', 'reported')], [turn(2)]: [helper('fixer')] } } }))
  assert.equal(draws, 1, 'the same helpers sent again')
  await mounted.change(() => send({ type: 'state', rev: rev++, set: { jobChildren: { [turn(1)]: [helper('scout', 'reported')], [turn(2)]: [helper('fixer', 'reported')] } } }))
  assert.equal(draws, 2)
  assert.equal(shown[0]?.state, 'reported')
  await mounted.unmount()
})
