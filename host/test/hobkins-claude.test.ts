import assert from 'node:assert/strict'
import type { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { test } from 'node:test'
import { sessionUsage } from 'hobkin/src/cli/work/store.mjs'
import { CLAUDE_CODE_DEFAULTS, changeClaudeCode } from '#shared/protocol/claude-code.ts'
import { runClaudeHarness, type ClaudeHarnessRequest, type ClaudeHarnessResult } from '../src/claude-code/harness.ts'
import { routeHarness } from '../src/claude-code/route.ts'
import { temporaryDirectory } from './support.ts'

const SESSION = '5d1c8e0a-7b2f-4c3d-9e4a-6f5b8a7c9d01'

/** A claude that answers the first message it is sent and then ends. Nothing runs. */
class FakeClaude extends EventEmitter {
  pid = 4242
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdin: Writable

  constructor(answer: string) {
    super()
    this.stdin = new Writable({
      write: (_chunk, _encoding, done) => {
        const line = (record: object) => this.stdout.write(`${JSON.stringify(record)}\n`)
        line({ type: 'system', subtype: 'init', session_id: SESSION, cwd: '/work', model: 'claude-sonnet-4-5', tools: [], permissionMode: 'bypassPermissions' })
        line({ type: 'assistant', message: { id: 'm1', role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: answer }], usage: { input_tokens: 5, output_tokens: 7 } }, parent_tool_use_id: null, session_id: SESSION })
        line({ type: 'result', subtype: 'success', is_error: false, result: answer, session_id: SESSION, total_cost_usd: 0.01 })
        done()
      },
      final: (done) => {
        done()
        this.stdout.end()
        this.stderr.end()
        setImmediate(() => this.emit('close', 0, null))
        this.emit('exit', 0, null)
      },
    })
  }

  kill() {
    return true
  }
}

test('a Claude hobkin runs with nothing asked and resumes its session', async (t) => {
  const home = temporaryDirectory(t)
  const spawned: string[][] = []
  const spawnProcess = ((_command: string, args: string[]) => {
    spawned.push(args)
    return new FakeClaude(`answer ${spawned.length}`)
  }) as unknown as typeof spawn

  const turn = async (settings: typeof CLAUDE_CODE_DEFAULTS, request: Record<string, unknown>) => {
    const run = routeHarness({
      pi: async () => assert.fail('a Claude hobkin never goes to Pi'),
      claude: (given, options, launch) =>
        runClaudeHarness(given as unknown as ClaudeHarnessRequest, options as object, { ...launch, ask: async () => undefined, spawnProcess, env: {}, stopMs: 20, killMs: 80 }),
      settings: () => settings,
      findClaude: () => '/opt/claude/bin/claude',
      // Only the run's title is taken from its record, for a question Claude asks.
      runFor: async () => ({ scheduleId: 'hobkin.a1b2c3d4', title: 'Tests' }),
      directions: () => assert.fail('a durable turn brings its own directions'),
    })
    return (await run(request, {})) as ClaudeHarnessResult
  }
  const sessionFile = join(home, 'hobkins', 'a1b2c3d4.jsonl')
  const request = { harness: 'claude', purpose: 'durable', cwd: home, directions: 'You are a durable hobkin.', sessionFile }
  const modeOf = (args: string[]) => args[args.indexOf('--permission-mode') + 1]

  // Turn one, with Claude Code switched off globally and every permission asked.
  const off = changeClaudeCode(CLAUDE_CODE_DEFAULTS, { enabled: false, permissions: 'ask' })
  const first = await turn(off, { ...request, id: 'hobkin:a1b2c3d4:1', prompt: 'Look at the tests.' })
  assert.equal(first.status, 'completed')
  assert.equal(first.sessionId, SESSION)
  assert.equal(modeOf(spawned[0]!), 'bypassPermissions')
  assert.ok(spawned[0]!.includes('--session-id'))
  assert.equal(spawned[0]![spawned[0]!.indexOf('--append-system-prompt') + 1], 'You are a durable hobkin.')

  // Turn two, with it switched on and asking: it still asks nothing, and it resumes the first turn's session.
  const on = changeClaudeCode(CLAUDE_CODE_DEFAULTS, { enabled: true, permissions: 'ask' })
  const second = await turn(on, { ...request, id: 'hobkin:a1b2c3d4:2', prompt: 'Now fix the flaky one.', resume: first.sessionId })
  assert.equal(second.status, 'completed')
  assert.equal(modeOf(spawned[1]!), 'bypassPermissions')
  assert.equal(spawned[1]![spawned[1]!.indexOf('--resume') + 1], SESSION)
  assert.ok(!spawned[1]!.includes('--session-id'), 'a resumed turn starts no new session')

  // Both turns wrote the one session file: one header, and the usage of both.
  const lines = readFileSync(sessionFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { type: string })
  assert.equal(lines.filter((line) => line.type === 'session').length, 1)
  assert.equal(lines[0]!.type, 'session')
  assert.deepEqual(sessionUsage(sessionFile), { tokens: 24, cached: 0, usd: 0, sessionId: SESSION })
})

test("a Claude hobkin's own model and thinking are what Claude Code gets, and default passes neither", async (t) => {
  const home = temporaryDirectory(t)
  const spawned: string[][] = []
  const spawnProcess = ((_command: string, args: string[]) => {
    spawned.push(args)
    return new FakeClaude('answer')
  }) as unknown as typeof spawn
  // The Claude Code tile says Sonnet at high. A hobkin that chose for itself does not follow it.
  const tile = changeClaudeCode(CLAUDE_CODE_DEFAULTS, { model: 'sonnet', effort: 'high' })
  const run = routeHarness({
    pi: async () => assert.fail('a Claude hobkin never goes to Pi'),
    claude: (given, options, launch) =>
      runClaudeHarness(given as unknown as ClaudeHarnessRequest, options as object, { ...launch, ask: async () => undefined, spawnProcess, env: {}, stopMs: 20, killMs: 80 }),
    settings: () => tile,
    findClaude: () => '/opt/claude/bin/claude',
    runFor: async () => ({ scheduleId: 'hobkin.a1b2c3d4', title: 'Tests' }),
    directions: () => assert.fail('a durable turn brings its own directions'),
  })
  const request = { harness: 'claude', purpose: 'durable', cwd: home, effort: 'medium', directions: 'You are a durable hobkin.', prompt: 'Go.' }
  const flag = (args: string[], name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
  const turn = async (n: number, claude?: Record<string, unknown>) => {
    await run({ ...request, id: `hobkin:a1b2c3d4:${n}`, sessionFile: join(home, 'hobkins', `turn-${n}.jsonl`), ...(claude ? { claude } : {}) }, {})
    const args = spawned.at(-1)!
    return [flag(args, '--model'), flag(args, '--effort'), flag(args, '--permission-mode')]
  }

  assert.deepEqual(await turn(1, { model: 'opus', effort: 'max' }), ['opus', 'max', 'bypassPermissions'])
  // `default` is Claude Code's own: no model and no level are passed, whatever the tile and the main chat run at.
  assert.deepEqual(await turn(2, { model: 'default', effort: 'default' }), [null, null, 'bypassPermissions'])
  // One that chose nothing, as before this choice existed, follows the tile.
  assert.deepEqual(await turn(3), ['sonnet', 'high', 'bypassPermissions'])
  // What is not one of Claude Code's own is never passed on.
  assert.deepEqual(await turn(4, { model: '--dangerously-skip', effort: 'tier' }), ['sonnet', 'high', 'bypassPermissions'])
})

test("a Claude hobkin's turn gets the token and home hobkin gives it", async (t) => {
  const home = temporaryDirectory(t)
  const started: NodeJS.ProcessEnv[] = []
  const spawnProcess = ((_command: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
    started.push(options.env)
    return new FakeClaude('answer')
  }) as unknown as typeof spawn
  // As the host runs it: the launch is the setup, with no environment of the test's own.
  const run = routeHarness({
    pi: async () => assert.fail('a Claude hobkin never goes to Pi'),
    claude: (given, options, launch) =>
      runClaudeHarness(given as unknown as ClaudeHarnessRequest, options as object, { ...launch, ask: async () => undefined, spawnProcess, stopMs: 20, killMs: 80 }),
    settings: () => CLAUDE_CODE_DEFAULTS,
    findClaude: () => '/opt/claude/bin/claude',
    runFor: async () => ({ scheduleId: 'hobkin.a1b2c3d4', title: 'Tests' }),
    directions: () => assert.fail('a durable turn brings its own directions'),
  })
  const token = 'a'.repeat(32)
  const request = { harness: 'claude', purpose: 'durable', id: 'hobkin:a1b2c3d4:1', cwd: home, prompt: 'Go.', directions: 'You are a durable hobkin.', sessionFile: join(home, 'hobkins', 'a1b2c3d4.jsonl') }
  const result = (await run({ ...request, env: { HOBKIN_TURN: token, HOBKIN_HOME: home } }, {})) as ClaudeHarnessResult
  assert.equal(result.status, 'completed')
  assert.deepEqual([started[0]!.HOBKIN_TURN, started[0]!.HOBKIN_HOME], [token, home])
  assert.equal(started[0]!.PATH, process.env.PATH, 'and the rest of the host environment, as before')

  // A request with nothing of its own keeps the host environment as it was.
  await run({ ...request, id: 'hobkin:a1b2c3d4:2' }, {})
  assert.equal(started[1]!.HOBKIN_TURN, process.env.HOBKIN_TURN)
})
