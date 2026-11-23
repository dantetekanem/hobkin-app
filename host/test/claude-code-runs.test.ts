import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CLAUDE_CODE_DEFAULTS, changeClaudeCode, type ClaudeCodeSettings } from '#shared/protocol/claude-code.ts'
import { routeHarness, type RunFacts } from '../src/claude-code/route.ts'
import { ClaudeRuns } from '../src/claude-code/runs.ts'

/** A router over fake harnesses that tells `onClaude` of each run it sends to Claude Code. */
function router(settings: ClaudeCodeSettings, claudePath: string | null = '/usr/local/bin/claude') {
  const told: string[] = []
  const runs: Record<string, RunFacts> = {
    w1: { scheduleId: 'work.project.item', title: 'Fix the login redirect' },
    r1: { scheduleId: 'daily-inbox', title: 'Inbox check' },
    t1: { scheduleId: 'hobkin.0a1b2c3d', title: 'Tidy the docs' },
  }
  const run = routeHarness({
    pi: async () => ({ status: 'completed', via: 'pi' }),
    claude: async () => ({ status: 'completed', via: 'claude' }),
    settings: () => settings,
    findClaude: () => claudePath,
    runFor: async (harnessId) => runs[harnessId],
    directions: () => '',
    onClaude: (harnessId) => told.push(harnessId),
  })
  return { run, told }
}

const work = { id: 'w1', harness: 'pi', purpose: 'work-do', cwd: '/tmp/project', prompt: 'Do the item.' }
const routine = { id: 'r1', harness: 'pi', cwd: '/tmp', prompt: 'Check the inbox.' }
const durable = { id: 't1', harness: 'claude', purpose: 'durable', cwd: '/tmp/project', prompt: 'Tidy the docs.' }

test('the route tells which runs it sends to Claude Code, and of no run it leaves on Pi', async () => {
  const workOnly = router(changeClaudeCode(CLAUDE_CODE_DEFAULTS, { enabled: true, kinds: { sessions: false, routines: false } }))
  await workOnly.run(work, {})
  await workOnly.run(routine, {})
  await workOnly.run({ ...routine, id: 'x1', purpose: 'reflection' }, {})
  await workOnly.run(durable, {})
  assert.deepEqual(workOnly.told, ['w1', 't1'])

  const off = router(CLAUDE_CODE_DEFAULTS)
  await off.run(work, {})
  assert.deepEqual(off.told, [], 'with Claude Code off nothing goes there')

  const missing = router(changeClaudeCode(CLAUDE_CODE_DEFAULTS, { enabled: true }), null)
  await missing.run(work, {})
  assert.deepEqual(missing.told, [], 'a run that could not start on Claude Code never ran there')
})

test("the window's runs say which are on Claude Code, by the harness id the route was given", () => {
  const runs = new ClaudeRuns()
  const snapshot = {
    connection: 'connected',
    runs: [
      { id: 'run-w1', harnessId: 'w1', title: 'Fix the login redirect', state: 'running' },
      { id: 'run-r1', harnessId: 'r1', title: 'Inbox check', state: 'running' },
      { title: 'jobs/broken.json: unreadable', state: 'invalid' },
    ],
  }
  assert.equal(runs.mark(snapshot), snapshot, 'with nothing on Claude Code the snapshot is as hobkin gave it')

  runs.routed('w1')
  const marked = runs.mark(snapshot)
  assert.deepEqual(marked.runs, [
    { id: 'run-w1', harnessId: 'w1', title: 'Fix the login redirect', state: 'running', onClaudeCode: true },
    { id: 'run-r1', harnessId: 'r1', title: 'Inbox check', state: 'running' },
    { title: 'jobs/broken.json: unreadable', state: 'invalid' },
  ])
  assert.equal(marked.connection, 'connected')
  assert.equal('onClaudeCode' in snapshot.runs[0]!, false, "hobkin's own rows are left as they were")
  assert.equal(runs.mark(snapshot).runs, marked.runs, 'the same runs while nothing changed, so they are not sent again')

  runs.routed('r1')
  assert.notEqual(runs.mark(snapshot).runs, marked.runs, 'another run on Claude Code makes new rows')
  const saved = { connection: 'offline' }
  assert.equal(runs.mark(saved), saved, 'a snapshot without runs stays as it is')
})

test('only the latest runs sent to Claude Code are kept', () => {
  const runs = new ClaudeRuns({ most: 2 })
  for (const id of ['a', 'b', 'c']) runs.routed(id)
  const marked = runs.mark({ runs: ['a', 'b', 'c'].map((harnessId) => ({ harnessId, title: harnessId, state: 'running' })) })
  assert.deepEqual(marked.runs!.map((run) => 'onClaudeCode' in run), [false, true, true])
})
