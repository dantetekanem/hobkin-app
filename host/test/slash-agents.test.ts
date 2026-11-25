import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { RunSummary } from '#shared/protocol/snapshot.ts'
import { SlashCommands } from '../src/slash.ts'
import { temporaryDirectory } from './support.ts'

// What Pi's `get_commands` lists for an agent's session: an extension command, a prompt template and a skill.
const COMMANDS = [
  { name: 'review', description: 'Review the branch\nand say what is left', source: 'extension' },
  { name: 'fix-tests', description: 'Fix failing tests', source: 'prompt' },
  { name: 'skill:humanizer', description: 'Rewrite AI-sounding text', source: 'skill' },
]
const HOBKIN = 'abcd1234'
const RUNS: RunSummary[] = [
  { id: 'run-1', kind: 'background', state: 'running', title: 'Fix the parser', scheduleId: 'job.fix' },
  { id: 'run-2', kind: 'background', state: 'completed', title: 'Old', scheduleId: 'job.old' },
]

/** hobkin's application as far as agents' commands go: it records what reaches each session. */
function fixture(t: TestContext, { hobkinState = 'waiting' } = {}) {
  const calls: unknown[][] = []
  const app = {
    runtime: {
      runCommands: async (run: string) => {
        if (run !== 'run-1') throw Error('That agent is not working.')
        return structuredClone(COMMANDS)
      },
    },
    runner: {
      messageCheck: async (request: { message?: string }) => {
        calls.push(['message', request])
        return { status: request.message?.startsWith('/review') ? 'handled' : 'queued' }
      },
    },
    hobkins: {
      commands: async (id: string) => (id === HOBKIN ? structuredClone(COMMANDS) : Promise.reject(Error('There is no hobkin with that id.'))),
      read: async () => ({ hobkin: { state: hobkinState } }),
      say: async (id: string, args: { text: string }) => {
        calls.push(['say', id, args])
        return { started: hobkinState === 'waiting', queued: false, run: `hobkin:${id}:2` }
      },
    },
  }
  const slash = new SlashCommands({ root: temporaryDirectory(t), clear: async () => {}, runs: () => RUNS })
  return { calls, slash, app: app as never }
}

const names = (listed: { name: string }[]) => listed.map(({ name }) => name)

test("an agent's page lists what Pi offers its own session, by name, and none while no session holds it", async (t) => {
  const { slash, app } = fixture(t)

  const listed = await slash.list(app, { run: 'run-1' })
  assert.deepEqual(listed, [
    { name: '/fix-tests', description: 'Fix failing tests', source: 'pi', count: 0 },
    { name: '/review', description: 'Review the branch', source: 'pi', count: 0 },
    { name: '/skill:humanizer', description: 'Rewrite AI-sounding text', source: 'pi', count: 0 },
  ])
  assert.deepEqual(names(await slash.list(app, { hobkin: HOBKIN })), ['/fix-tests', '/review', '/skill:humanizer'], "hobkin's own commands are the main chat's only")

  assert.deepEqual(await slash.list(app, { run: 'run-2' }), [], 'a finished run has no session to ask')
  assert.deepEqual(await slash.list(app, { hobkin: 'ffffffff' }), [])
  assert.deepEqual(await slash.list({ runtime: {}, hobkins: {} } as never, { run: 'run-1' }), [], 'a runtime from before lists none')
})

test("an agent's command goes to its own session as typed, and is counted with the main chat's", async (t) => {
  const { calls, slash, app } = fixture(t)

  // A template or a skill becomes the message Pi expands. An extension command runs, and nothing is sent as a message.
  assert.deepEqual(await slash.run(app, '/fix-tests', 'the parser', { run: 'run-1' }), { sent: { run: 'run-1', started: false } })
  assert.deepEqual(await slash.run(app, '/review', '', { run: 'run-1' }), { said: 'Ran /review.' })
  assert.deepEqual(calls, [
    ['message', { scheduleId: 'job.fix', runId: 'run-1', message: '/fix-tests the parser' }],
    ['message', { scheduleId: 'job.fix', runId: 'run-1', message: '/review' }],
  ])
  const counted = Object.fromEntries((await slash.list(app, { run: 'run-1' })).map(({ name, count }) => [name, count]))
  assert.deepEqual(counted, { '/fix-tests': 1, '/review': 1, '/skill:humanizer': 0 })

  // What its session does not offer is not sent, and a run that is not working takes nothing.
  await assert.rejects(slash.run(app, '/nope', '', { run: 'run-1' }), /There is no command \/nope/)
  await assert.rejects(slash.run(app, '/fix-tests', '', { run: 'run-2' }), /There is no command/)
  assert.equal(calls.length, 2)
})

test('a durable hobkin takes a template or skill while it waits, and runs an extension command only while it works', async (t) => {
  const waiting = fixture(t)
  assert.deepEqual(await waiting.slash.run(waiting.app, '/skill:humanizer', 'the notes', { hobkin: HOBKIN }), { sent: { run: `hobkin:${HOBKIN}:2`, started: true } })
  await assert.rejects(waiting.slash.run(waiting.app, '/review', '', { hobkin: HOBKIN }), /runs \/review only while it works/)
  assert.deepEqual(waiting.calls, [['say', HOBKIN, { text: '/skill:humanizer the notes' }]])

  const working = fixture(t, { hobkinState: 'working' })
  assert.deepEqual(await working.slash.run(working.app, '/review', 'now', { hobkin: HOBKIN }), { said: 'Ran /review.' })
  assert.deepEqual(working.calls, [['say', HOBKIN, { text: '/review now' }]])
})
