import assert from 'node:assert/strict'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { JobActivity, MOST_OUTPUT, MOST_STEPS } from 'hobkin/src/cli/job-activity.mjs'
import { runSteps } from 'hobkin/src/cli/run-steps.mjs'
import { runCommand } from '../src/commands.ts'
import { olderStepsHandlers, type OlderStepsSeat } from '../src/older-steps.ts'
import { loadPiCodingAgent } from '../src/pi.ts'
import { temporaryDirectory } from './support.ts'

const HARNESS_ID = '0b7e4f2a-3c5d-4e6f-8a9b-1c2d3e4f5a6b'
const JOB = `work:api:do:${HARNESS_ID}`

type Session = { appendMessage(message: unknown): void }
type Runs = Awaited<ReturnType<OlderStepsSeat['state']>>['runs']

/**
 * A home with one work run that made 300 steps, saved by Pi's own session manager as Pi saves them, and the feed
 * hobkin keeps of it: its newest 200 steps, a long output cut to its ends.
 */
async function savedRun(t: Parameters<typeof temporaryDirectory>[0], runs?: Runs) {
  const data = temporaryDirectory(t)
  mkdirSync(join(data, 'jobs'))
  const file = join(data, 'jobs', `${HARNESS_ID}.jsonl`)
  const pi = (await loadPiCodingAgent()) as unknown as { SessionManager: { open(file: string, cwd: string, folder: string): Session } }
  const session = pi.SessionManager.open(file, data, join(data, 'jobs'))
  const feed = new JobActivity({ most: MOST_STEPS, mostOutput: MOST_OUTPUT })
  const say = (message: Record<string, unknown>) => {
    feed.accept({ type: 'message_start', message })
    feed.accept({ type: 'message_end', message })
    session.appendMessage(message)
  }
  const long = 'a line of test output\n'.repeat(2000)
  say({ role: 'user', content: 'Fix the job.', timestamp: Date.now() })
  for (let index = 0; index < 150; index++) {
    const call = { type: 'toolCall', id: `call-${index}`, name: 'bash', arguments: { command: `npm test -- ${index}` } }
    say({ role: 'assistant', content: [{ type: 'text', text: `Running part ${index}.` }, call], stopReason: 'toolUse', timestamp: Date.now() })
    const content = [{ type: 'text', text: index === 149 ? long : `ok ${index}` }]
    feed.accept({ type: 'tool_execution_end', toolCallId: call.id, toolName: 'bash', result: { content }, isError: false })
    say({ role: 'toolResult', toolCallId: call.id, toolName: 'bash', content, isError: false, timestamp: Date.now() })
  }
  const seat: OlderStepsSeat = {
    data: () => data,
    state: async () => ({ runs: runs ?? { [JOB]: { kind: 'background', harness: 'pi', harnessId: HARNESS_ID } } }),
  }
  return { data, file, feed: feed.snapshot(), long, handlers: olderStepsHandlers(seat) }
}

test("a run's earlier steps come back from its saved session, right before its feed's oldest, with no gap and no repeat", async (t) => {
  const { file, feed, handlers } = await savedRun(t)
  assert.equal(feed.length, 200)

  const oldest = feed[0]!
  const page = await runCommand(handlers, 'activity.before', { job: JOB, before: oldest.id, ...(oldest.at ? { at: oldest.at } : {}) })
  assert.equal(page.ok, true)
  const { steps, more, found } = (page as { value: { steps: { id: string }[]; more: boolean; found: boolean } }).value
  assert.deepEqual([steps.length, more, found], [100, false, true])
  assert.deepEqual([...steps, ...feed].map(({ id }) => id), runSteps(file).map(({ id }) => id), 'the pages and the feed are every step once, in order')
})

test("a tool's output the feed keeps only the ends of comes back whole", async (t) => {
  const { feed, long, handlers } = await savedRun(t)
  const cut = feed.at(-1)!
  assert.equal(cut.outputLength, long.length)

  assert.deepEqual(await runCommand(handlers, 'activity.output', { job: JOB, id: cut.id }), { ok: true, value: { id: cut.id, output: long, length: long.length } })
  assert.deepEqual(await runCommand(handlers, 'activity.output', { job: JOB, id: 'tool:nowhere' }), { ok: true, value: null })
})

test('a run the host does not know, one with no Pi session, and a session that is not a file in the jobs folder are refused', async (t) => {
  const refused = async (runs: Runs, job = JOB) => {
    const { handlers } = await savedRun(t, runs)
    const answer = await runCommand(handlers, 'activity.before', { job })
    return answer.ok ? 'answered' : answer.error.code
  }
  assert.equal(await refused({}), 'unavailable', 'a run hobkin has no record of')
  assert.equal(await refused({ [JOB]: { kind: 'background', harness: 'claude', harnessId: HARNESS_ID } }), 'unavailable', 'a Claude Code run')
  assert.equal(await refused({ [JOB]: { kind: 'background', harness: 'pi', harnessId: '../../outside' } }), 'unavailable', 'an id that is no session id')

  const { data, handlers } = await savedRun(t, { [JOB]: { kind: 'background', harness: 'pi', harnessId: '1b7e4f2a-3c5d-4e6f-8a9b-1c2d3e4f5a6b' } })
  const outside = join(temporaryDirectory(t), 'secret.jsonl')
  writeFileSync(outside, '{"type":"session","version":3,"id":"x"}\n')
  symlinkSync(outside, join(data, 'jobs', '1b7e4f2a-3c5d-4e6f-8a9b-1c2d3e4f5a6b.jsonl'))
  const linked = await runCommand(handlers, 'activity.output', { job: JOB, id: 'tool:call-1' })
  assert.equal(linked.ok ? 'answered' : linked.error.code, 'unavailable', 'a link out of the jobs folder')
})
