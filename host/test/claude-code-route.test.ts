import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CLAUDE_CODE_DEFAULTS, changeClaudeCode, type ClaudeCodeSettings } from '#shared/protocol/claude-code.ts'
import { routeHarness, type ClaudeLaunch, type RunFacts } from '../src/claude-code/route.ts'

interface Call {
  harness: 'pi' | 'claude'
  request: Record<string, unknown>
  options: unknown
  launch?: ClaudeLaunch
}

/** A router over fake harnesses, with the runs hobkin has admitted by harness id. */
function router(settings: ClaudeCodeSettings, runs: Record<string, RunFacts> = {}, claudePath: string | null = '/usr/local/bin/claude') {
  const calls: Call[] = []
  const lookups: string[] = []
  const signals: (AbortSignal | undefined)[] = []
  const run = routeHarness({
    pi: async (request, options) => {
      calls.push({ harness: 'pi', request, options })
      return { status: 'completed', via: 'pi' }
    },
    claude: async (request, options, launch) => {
      calls.push({ harness: 'claude', request, options, launch })
      return { status: 'completed', via: 'claude' }
    },
    settings: () => settings,
    findClaude: () => claudePath,
    runFor: async (harnessId, signal) => {
      lookups.push(harnessId)
      signals.push(signal)
      return runs[harnessId]
    },
    directions: (purpose) => `directions for ${purpose ?? 'a routine'}`,
  })
  return { run, calls, lookups, signals }
}

const work = { id: 'w1', harness: 'pi', purpose: 'work-do', cwd: '/tmp/project', prompt: 'Do the item.', sessionFile: '/tmp/w1.jsonl' }
const routine = { id: 'r1', harness: 'pi', cwd: '/tmp', prompt: 'Check the inbox.', sessionFile: '/tmp/r1.jsonl' }
const session = { id: 's1', harness: 'pi', cwd: '/tmp', prompt: 'Read brief.md and follow it.', sessionFile: '/tmp/s1.jsonl' }
const runs: Record<string, RunFacts> = {
  w1: { scheduleId: 'work.project.item', title: 'Fix the login redirect' },
  r1: { scheduleId: 'daily-inbox', title: 'Inbox check' },
  s1: { scheduleId: 'session.research', title: 'Research the move' },
}

test('with Claude Code off every run goes to Pi', async () => {
  const { run, calls, lookups } = router(CLAUDE_CODE_DEFAULTS, runs)
  const options = { onEvent: () => {} }
  for (const request of [work, routine, session, { ...routine, id: 'x', purpose: 'reflection' }]) {
    assert.deepEqual(await run(request, options), { status: 'completed', via: 'pi' })
  }
  assert.deepEqual(calls.map((call) => call.harness), ['pi', 'pi', 'pi', 'pi'])
  // Pi gets the very request and options hobkin gave, so nothing about a Pi run changes.
  assert.equal(calls[0].request, work)
  assert.equal(calls[0].options, options)
  assert.deepEqual(lookups, [], 'with it off, no run is even looked up')
})

test("a run's kind decides its route", async () => {
  const workOnly = changeClaudeCode(CLAUDE_CODE_DEFAULTS, { enabled: true, kinds: { sessions: false, routines: false } })
  const first = router(workOnly, runs)
  await first.run(work, {})
  await first.run(routine, {})
  await first.run(session, {})
  assert.deepEqual(first.calls.map((call) => call.harness), ['claude', 'pi', 'pi'])

  const everything = router(changeClaudeCode(CLAUDE_CODE_DEFAULTS, { enabled: true }), runs)
  await everything.run(session, {})
  await everything.run(routine, {})
  // Runs that use no tools stay on Pi whatever the settings.
  for (const purpose of ['reflection', 'compatibility-check', 'humanizer', 'migration-repair', 'session-patterns']) {
    await everything.run({ ...routine, id: `p-${purpose}`, purpose }, {})
  }
  // A run hobkin has no record of stays on Pi, since its kind is unknown.
  await everything.run({ ...routine, id: 'unknown' }, {})
  assert.deepEqual(
    everything.calls.map((call) => call.harness),
    ['claude', 'claude', 'pi', 'pi', 'pi', 'pi', 'pi', 'pi'],
  )

  // A routine's kind is in its record, and looking for the record gives up once the run is stopped.
  const stop = new AbortController()
  await everything.run({ ...routine, signal: stop.signal }, {})
  assert.equal(everything.signals.at(-1), stop.signal)
})

test('a run on Claude Code gets the binary, the settings, its title and its directions', async () => {
  const settings = changeClaudeCode(CLAUDE_CODE_DEFAULTS, { enabled: true, model: 'opus', permissions: 'ask' })
  const { run, calls } = router(settings, runs)
  const options = { onEvent: () => {} }
  await run(work, options)
  const [call] = calls
  assert.equal(call.request, work)
  assert.equal(call.options, options)
  assert.deepEqual(call.launch, {
    claude: '/usr/local/bin/claude',
    settings,
    title: 'Fix the login redirect',
    directions: 'directions for work-do',
  })
})

test('Claude Code missing fails the run with a reason instead of moving it to Pi', async () => {
  const { run, calls } = router(changeClaudeCode(CLAUDE_CODE_DEFAULTS, { enabled: true }), runs, null)
  const result = (await run(work, {})) as { status: string; error: string; harness: string }
  assert.equal(result.status, 'failed')
  assert.equal(result.harness, 'claude')
  assert.match(result.error, /Claude Code is not installed/)
  assert.deepEqual(calls, [], 'neither harness started')
})
