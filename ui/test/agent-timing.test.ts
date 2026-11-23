import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { after, mock, test } from 'node:test'
import type { ActivityEntry, ActivityStep } from '../../shared/protocol/activity.ts'
import type { HostMessage } from '../../shared/protocol/messages.ts'
import { applyHostMessage } from '../src/lib/host/state.ts'

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
const { entryTimeOf, lastStepTime } = await import('../src/features/agent-activity/use-agent-activity.ts')
after(() => {
  mock.restoreAll()
  mock.timers.reset()
  Reflect.deleteProperty(globalThis, 'window')
})

let rev = 1
const send = (message: HostMessage) => hostStore.setState((state) => applyHostMessage(state, message), true)
const bash = (id: string): ActivityEntry => ({ id, kind: 'tool', name: 'bash', state: 'running', input: '{"command":"pnpm test"}', output: '' })
const jobs = Array.from({ length: 30 }, (_, index) => `job-${index}`)
const run = (id: string, state = 'running') => ({ id, kind: 'background' as const, state, title: id, cwd: '/fake/app' })

send({ type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: null, viewState: null, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, signIn: { status: 'signed-in' } })
send({ type: 'state', rev: rev++, reset: true, set: { runs: jobs.map((id) => run(id)), reports: [] }, activity: jobs.map((job): ActivityStep => ({ op: 'reset', job, entries: [bash('tool:1')] })) })

/** How often the window asked whether the host still holds a job's steps. */
function jobChecks(during: () => void): number {
  const hasOwn = mock.method(Object, 'hasOwn')
  during()
  const count = hasOwn.mock.calls.filter((call) => typeof call.arguments[1] === 'string' && jobs.includes(call.arguments[1])).length
  hasOwn.mock.restore()
  return count
}

test('ten messages of one job printing more look at no other job', () => {
  const checks = jobChecks(() => {
    for (let index = 0; index < 10; index++) send({ type: 'state', rev: rev++, activity: [{ op: 'extend', job: 'job-0', id: 'tool:1', field: 'output', add: `line ${index}\n` }] })
  })
  assert.equal(checks, 0)
  assert.ok(entryTimeOf('job-0', 'tool:1'), 'its step is still timed')
})

test('a job takes its times with it once the host holds none of its steps and it is not running', () => {
  assert.ok(entryTimeOf('job-1', 'tool:1'))
  // Its run ends while the host still holds its steps: they stay timed.
  send({ type: 'state', rev: rev++, set: { runs: jobs.map((id) => run(id, id === 'job-1' || id === 'job-2' ? 'completed' : 'running')) } })
  assert.ok(entryTimeOf('job-1', 'tool:1'))
  // The host lets go of them in a message of steps alone.
  send({ type: 'state', rev: rev++, activity: [{ op: 'remove', job: 'job-1' }] })
  assert.equal(entryTimeOf('job-1', 'tool:1'), undefined)
  assert.ok(entryTimeOf('job-2', 'tool:1'), 'a job still held keeps its times')
  // A running job the host lets go of keeps them, as its steps may come back.
  send({ type: 'state', rev: rev++, activity: [{ op: 'remove', job: 'job-3' }] })
  assert.ok(entryTimeOf('job-3', 'tool:1'))
})

test("the last step's time is worked out once for the same steps", () => {
  const entries = (hostStore.getState().snapshot.jobActivity as Record<string, readonly ActivityEntry[]>)['job-4']!
  let reads = 0
  const timeOf = (id: string) => {
    reads += 1
    return entryTimeOf('job-4', id)
  }
  const first = lastStepTime(entries, timeOf)
  assert.equal(typeof first, 'number')
  assert.equal(lastStepTime(entries, timeOf), first)
  assert.equal(reads, entries.length, 'read once for each step, not again for the same steps')
})
