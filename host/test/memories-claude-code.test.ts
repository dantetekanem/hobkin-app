import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { workDirections } from 'hobkin/src/cli/harnesses.mjs'
import { runIndex } from 'hobkin/src/cli/memories.mjs'
import { memorySave } from 'hobkin/src/cli/memory-window.mjs'
import { CLAUDE_CODE_DEFAULTS, changeClaudeCode, type ClaudeCodeSettings } from '#shared/protocol/claude-code.ts'
import { claudeDirections } from '../src/claude-code/directions.ts'
import { routeHarness, type ClaudeLaunch, type RunFacts } from '../src/claude-code/route.ts'
import { temporaryDirectory } from './support.ts'

// A routine, a session run and a Work run on Claude Code read hobkin's memories as the same runs on Pi do
// (057-shared-memory): the index in the request hobkin built, whose header says how to read one whole and suggest one.

const BACKGROUND = readFileSync(new URL('../prompts/background.md', import.meta.resolve('hobkin/src/cli/harnesses.mjs')), 'utf8')
const RUNS: Record<string, RunFacts> = {
  r1: { scheduleId: 'daily-inbox', title: 'Inbox check' },
  s1: { scheduleId: 'session.research', title: 'Research the move' },
  w1: { scheduleId: 'work.project.item', title: 'Fix the login redirect' },
}

interface Sent {
  harness: 'pi' | 'claude'
  request: Record<string, unknown>
  launch?: ClaudeLaunch
}

function router(settings: ClaudeCodeSettings) {
  const sent: Sent[] = []
  const run = routeHarness({
    pi: async (request) => (sent.push({ harness: 'pi', request }), { status: 'completed' }),
    claude: async (request, _options, launch) => (sent.push({ harness: 'claude', request, launch }), { status: 'completed' }),
    settings: () => settings,
    findClaude: () => '/usr/local/bin/claude',
    runFor: async (harnessId) => RUNS[harnessId],
    directions: claudeDirections(workDirections, BACKGROUND),
  })
  return { run, sent }
}

/** A home with a shared memory and a private one, and the requests hobkin builds for its runs there. */
function homeWithMemories(t: import('node:test').TestContext) {
  const root = temporaryDirectory(t)
  memorySave(root, { name: 'prefers-trains', description: 'Prefers the train under 600 km', kind: 'preference' })
  memorySave(root, { name: 'partner-name', description: 'Partner is called Ana', kind: 'user', private: true })
  // As hobkin's runner, session jobs and Work director put it in the request (057-shared-memory).
  const memories = runIndex(root, 'hobkin_recall')
  const request = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
    id,
    harness: 'pi',
    cwd: root,
    prompt: JSON.stringify({ task: 'Do the job.', memories }),
    memories: 'run',
    env: { HOBKIN_RUN: title },
    ...extra,
  })
  return {
    memories,
    requests: [request('r1', 'Inbox check'), request('s1', 'Research the move'), request('w1', 'Fix the login redirect', { purpose: 'work-do' })],
  }
}

test('a run on Claude Code reads the same index of shared memories a run on Pi reads, with no private one', async (t) => {
  const { memories, requests } = homeWithMemories(t)
  assert.match(memories, /Prefers the train under 600 km/)
  assert.doesNotMatch(memories, /Partner is called Ana/)
  assert.ok(Buffer.byteLength(memories) <= 4096)

  const onPi = router(CLAUDE_CODE_DEFAULTS)
  const onClaude = router(changeClaudeCode(CLAUDE_CODE_DEFAULTS, { enabled: true }))
  for (const request of requests) {
    await onPi.run(request, {})
    await onClaude.run(request, {})
  }

  assert.deepEqual(onClaude.sent.map(({ harness }) => harness), ['claude', 'claude', 'claude'])
  assert.deepEqual(
    onClaude.sent.map(({ request }) => request.prompt),
    onPi.sent.map(({ request }) => request.prompt),
    'Claude Code gets the very prompt Pi would, index and all',
  )
})

test('a run on Claude Code is told to read a memory whole with hobkin memory, and that it can only suggest one', async (t) => {
  const { requests } = homeWithMemories(t)
  const { run, sent } = router(changeClaudeCode(CLAUDE_CODE_DEFAULTS, { enabled: true }))
  for (const request of requests) await run(request, {})

  // The rules come in the header of the index the request carries, for Pi's tools and for a shell alike.
  for (const { request, launch } of sent) {
    const { memories } = JSON.parse(String(request.prompt)) as { memories: string }
    assert.match(memories, /Read one whole with hobkin_recall, or with `hobkin memory get <name>` in your shell when you have no such tool\./, String(request.id))
    assert.match(memories, /You cannot save one: suggest/, String(request.id))
    assert.match(memories, /with hobkin_suggest_memory, or `hobkin memory suggest` with it as JSON on standard input/, String(request.id))
    assert.equal(launch!.env?.HOBKIN_RUN, RUNS[String(request.id)]!.title, 'its suggestion names the run')
  }
})
