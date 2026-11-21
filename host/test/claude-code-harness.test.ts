import assert from 'node:assert/strict'
import type { spawn } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { test, type TestContext } from 'node:test'
import type { QuestionAnswer } from 'hobkin/src/cli/application.mjs'
import { followUsage, sessionError, sessionUsage } from 'hobkin/src/cli/work/store.mjs'
import { CLAUDE_CODE_DEFAULTS, type ClaudeCodeSettings } from '#shared/protocol/claude-code.ts'
import { runClaudeHarness, type ClaudeChild, type ClaudeHarnessOptions, type ClaudeHarnessRequest, type ClaudeRunSetup } from '../src/claude-code/harness.ts'
import type { Ask, AskRequest } from '../src/questions.ts'
import { temporaryDirectory } from './support.ts'

const RUN_ID = '0b7e4f2a-3c5d-4e6f-8a9b-1c2d3e4f5a6b'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MODEL = 'claude-sonnet-4-5'
const TITLE = 'Fix the flaky cache test'
const DIRECTIONS = 'Work in the background and say what you did.'
const SETTINGS: ClaudeCodeSettings = { ...CLAUDE_CODE_DEFAULTS, enabled: true, model: 'sonnet', effort: 'tier', permissions: 'ask' }

type Line = Record<string, any>

/** The `claude` process as the harness sees it: lines in on stdin, records out on stdout, and its end. Nothing runs. */
class FakeClaude extends EventEmitter {
  pid: number | undefined = 4242
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdin: Writable
  readonly written: Line[] = []
  inputClosed = false
  exited = false
  /** What it does when its process group is signalled. By default it dies. */
  onSignal = (signal: string) => this.exit(null, signal)

  constructor() {
    super()
    let pending = ''
    this.stdin = new Writable({
      write: (chunk, _encoding, done) => {
        pending += String(chunk)
        for (let end = pending.indexOf('\n'); end !== -1; end = pending.indexOf('\n')) {
          this.written.push(JSON.parse(pending.slice(0, end)))
          pending = pending.slice(end + 1)
        }
        done()
      },
      final: (done) => {
        this.inputClosed = true
        done()
      },
    })
  }

  print(...records: Line[]) {
    for (const record of records) this.stdout.write(`${JSON.stringify(record)}\n`)
  }

  exit(code: number | null, signal: string | null = null) {
    if (this.exited) return
    this.exited = true
    this.stdout.end()
    this.stderr.end()
    this.emit('exit', code, signal)
    void Promise.all([once(this.stdout, 'end'), once(this.stderr, 'end')]).then(() => this.emit('close', code, signal))
  }

  kill() {
    return true
  }
}

async function until(check: () => unknown, what = 'the expected state'): Promise<void> {
  const deadline = Date.now() + 3000
  while (!check()) {
    if (Date.now() > deadline) throw Error(`Timed out waiting for ${what}.`)
    await delay(1)
  }
}

interface Launch {
  settings?: ClaudeCodeSettings
  request?: Partial<ClaudeHarnessRequest>
  setup?: Partial<ClaudeRunSetup>
  options?: Pick<ClaudeHarnessOptions, 'metricsRoot' | 'turn'>
}

/** One run on a fake claude, with everything the harness hands back. */
function launch(t: TestContext, { settings = SETTINGS, request = {}, setup = {}, options = {} }: Launch = {}) {
  const home = temporaryDirectory(t)
  const fake = new FakeClaude()
  const spawned: { command: string; args: string[]; options: Line }[] = []
  const signals: string[] = []
  const events: Line[] = []
  let send: ((message: string, images?: { type: 'image'; data: string; mimeType: string }[]) => Promise<{ disposition: 'queued' }>) | undefined
  let child: ClaudeChild | undefined
  const run: ClaudeHarnessRequest = {
    id: RUN_ID,
    cwd: join(home, 'project'),
    prompt: 'Fix the flaky cache test.',
    sessionFile: join(home, 'jobs', `${RUN_ID}.jsonl`),
    effort: 'minimal',
    purpose: 'work-do',
    ...request,
  }
  const spawnProcess = ((command: string, args: string[], options: Line) => {
    spawned.push({ command, args, options })
    return fake
  }) as unknown as typeof spawn
  const finished = runClaudeHarness(run, {
    ...options,
    onEvent: (event) => events.push(event),
    onReady: (given) => (send = given),
    onControl: (given) => (child = given),
  }, {
    claude: '/opt/claude/bin/claude',
    settings,
    title: TITLE,
    directions: DIRECTIONS,
    ask: async () => undefined,
    spawnProcess,
    env: { PATH: '/usr/bin:/bin', HOME: '/Users/someone' },
    signalGroup: (_child, signal) => {
      signals.push(signal)
      fake.onSignal(signal)
    },
    stopMs: 20,
    killMs: 80,
    askRetryMs: 5,
    askGiveUpMs: 200,
    ...setup,
  })
  return { fake, spawned, signals, events, finished, request: run, send: () => send, child: () => child }
}

const init = (session = RUN_ID) => ({ type: 'system', subtype: 'init', session_id: session, cwd: '/work', model: MODEL, tools: ['Bash', 'Edit'], permissionMode: 'default' })
const usage = (input: number, output: number, cacheWrite = 0, cacheRead = 0) => ({ input_tokens: input, output_tokens: output, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead })
const result = (text: string, more: Line = {}) => ({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: RUN_ID, total_cost_usd: 0.01, ...more })
const replay = (text: string) => ({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, parent_tool_use_id: null, session_id: RUN_ID, isReplay: true })
const userLine = (text: string, session = RUN_ID) => ({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, parent_tool_use_id: null, session_id: session })
const withoutUuid = ({ uuid, ...line }: Line) => {
  assert.match(uuid, UUID, 'each message names itself, so Claude can acknowledge it')
  return line
}
const canUseTool = (id: string, tool: string, input: Line) => ({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: tool, input, tool_use_id: `toolu_${id}` } })
const answerTo = (lines: Line[], id: string) => lines.find((line) => line.type === 'control_response' && line.response?.request_id === id)

test("starts claude headless with the run's settings", async (t) => {
  const run = launch(t, { setup: { env: { PATH: '/usr/bin:/bin', HOME: '/Users/someone', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' } } })
  await until(() => run.fake.written.length === 1 && run.send(), 'the prompt')
  const [{ command, args, options }] = run.spawned as [(typeof run.spawned)[number]]
  assert.equal(command, '/opt/claude/bin/claude')
  assert.deepEqual(args, [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--replay-user-messages',
    '--permission-prompt-tool', 'stdio', '--permission-mode', 'default', '--session-id', RUN_ID, '--append-system-prompt', DIRECTIONS,
    '--model', 'sonnet', '--effort', 'low',
  ])
  assert.equal(options.cwd, run.request.cwd)
  assert.equal(options.detached, true, 'its own process group, so a signal reaches Claude and what it starts in that group')
  assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe'])
  assert.deepEqual(options.env, { PATH: '/usr/bin:/bin', HOME: '/Users/someone' }, 'a Claude Code that started the host does not make this one its child session')
  assert.deepEqual(withoutUuid(run.fake.written[0]!), userLine('Fix the flaky cache test.'))
  run.fake.print(init(), result('Done.'))
  run.fake.exit(0)
  assert.equal((await run.finished).status, 'completed')

  const argsOf = async (settings: ClaudeCodeSettings, request: Partial<ClaudeHarnessRequest> = {}) => {
    const other = launch(t, { settings, request })
    await until(() => other.fake.written.length === 1, 'the prompt')
    other.fake.exit(0)
    await other.finished
    return { args: other.spawned[0]!.args, first: other.fake.written[0]! }
  }
  const all = await argsOf({ ...SETTINGS, model: 'default', effort: 'max', permissions: 'all' })
  assert.deepEqual(all.args.slice(10), ['--permission-mode', 'bypassPermissions', '--session-id', RUN_ID, '--append-system-prompt', DIRECTIONS, '--effort', 'max'], "the account's default model passes no --model")
  assert.deepEqual((await argsOf({ ...SETTINGS, permissions: 'auto' }, { effort: 'xhigh' })).args.slice(10, 12), ['--permission-mode', 'auto'])
  assert.deepEqual((await argsOf({ ...SETTINGS, permissions: 'edits' }, { effort: 'xhigh' })).args.slice(-4), ['--model', 'sonnet', '--effort', 'xhigh'])
  assert.deepEqual((await argsOf(SETTINGS, { effort: 'off' })).args.slice(-2), ['--effort', 'low'])
  assert.deepEqual((await argsOf(SETTINGS, { effort: 'max' })).args.slice(-2), ['--effort', 'max'], "a tier at max runs at Claude Code's own max")
  assert.deepEqual((await argsOf(SETTINGS, { effort: 'unheard-of' })).args.slice(-2), ['--model', 'sonnet'], 'an effort Claude has no word for passes none')

  const named = await argsOf(SETTINGS, { id: 'routine:daily-notes:2026-11-12' })
  const session = named.args[named.args.indexOf('--session-id') + 1]!
  assert.match(session, UUID, 'a run id that is no session id gets a fresh one')
  assert.equal(named.first.session_id, session)
})

test('a message reaches Claude and its receipt follows', async (t) => {
  const run = launch(t)
  await until(() => run.send(), 'the run to take messages')
  run.fake.print(init())
  assert.deepEqual(await run.send()!('[hobkin-note:7d1f]\nAlso update the README.'), { disposition: 'queued' })
  await until(() => run.fake.written.length === 2, 'the message on stdin')
  assert.deepEqual(withoutUuid(run.fake.written[1]!), userLine('[hobkin-note:7d1f]\nAlso update the README.'))

  // Claude takes it in. The receipt is what hobkin's runner matches a note by: a user message with exactly the text sent.
  run.fake.print(replay('[hobkin-note:7d1f]\nAlso update the README.'))
  await until(() => run.events.some((event) => event.type === 'message_end' && event.message.role === 'user'), 'the receipt')
  assert.deepEqual(run.events.find((event) => event.message?.role === 'user'), {
    type: 'message_end',
    message: { role: 'user', content: [{ type: 'text', text: '[hobkin-note:7d1f]\nAlso update the README.' }] },
  })

  // The first result ends the run's taking messages, and its input closes, so Claude finishes and exits.
  run.fake.print(result('Done, README included.'))
  await until(() => run.fake.inputClosed, 'the input to close')
  await assert.rejects(run.send()!('One more thing.'), (error: Error & { notQueued?: boolean }) => error.notQueued === true && error.message === 'That check has finished.')
  run.fake.exit(0)
  const ended = await run.finished
  assert.equal(ended.status, 'completed')
  assert.equal(ended.text, 'Done, README included.')
})

test('images the user attached go to Claude as image blocks, and the receipt counts them', async (t) => {
  const chart = { type: 'image' as const, data: 'aW1hZ2U=', mimeType: 'image/png' }
  const block = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } }
  const run = launch(t, { request: { images: [chart] } })
  await until(() => run.send(), 'the run to take messages')
  assert.deepEqual(run.fake.written[0]!.message.content, [{ type: 'text', text: 'Fix the flaky cache test.' }, block], 'the first prompt carries its image')

  run.fake.print(init())
  await run.send()!('[hobkin-note:7d1f]\nThis one too.', [chart])
  await until(() => run.fake.written.length === 2, 'the message on stdin')
  assert.deepEqual(run.fake.written[1]!.message.content, [{ type: 'text', text: '[hobkin-note:7d1f]\nThis one too.' }, block])

  // Claude's replay of it says how many images it took, so hobkin's runner can match the note with its images.
  run.fake.print({ ...replay('[hobkin-note:7d1f]\nThis one too.'), message: { role: 'user', content: [{ type: 'text', text: '[hobkin-note:7d1f]\nThis one too.' }, block] } })
  await until(() => run.events.some((event) => event.type === 'message_end' && event.message.role === 'user'), 'the receipt')
  assert.deepEqual(run.events.find((event) => event.message?.role === 'user')?.message.content, [
    { type: 'text', text: '[hobkin-note:7d1f]\nThis one too.' },
    { type: 'image', mimeType: 'image/png' },
  ])
  run.fake.print(result('Done.'))
  await until(() => run.fake.inputClosed, 'the input to close')
  run.fake.exit(0)
  assert.equal((await run.finished).status, 'completed')
})

test('a finished run reports its text, cost and tokens, and records its usage', async (t) => {
  const run = launch(t)
  await until(() => run.send(), 'the run to start')
  const stream = (event: Line) => ({ type: 'stream_event', event, parent_tool_use_id: null, session_id: RUN_ID })
  const reply = (id: string, block: Line, used: Line) => ({ type: 'assistant', message: { id, role: 'assistant', model: MODEL, content: [block], usage: used }, parent_tool_use_id: null, session_id: RUN_ID })
  run.fake.print(
    init(),
    replay('Fix the flaky cache test.'),
    stream({ type: 'message_start', message: { id: 'msg_1', model: MODEL, usage: usage(12, 1, 3000) } }),
    reply('msg_1', { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } }, usage(12, 1, 3000)),
    stream({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 60 } }),
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '12 passing', is_error: false }] }, parent_tool_use_id: null, session_id: RUN_ID },
    reply('msg_2', { type: 'text', text: 'Fixed: the cache test waits for its writer.' }, usage(25, 40, 0, 3000)),
    result('Fixed: the cache test waits for its writer.', {
      total_cost_usd: 0.0421,
      modelUsage: { [MODEL]: { inputTokens: 37, outputTokens: 100, cacheReadInputTokens: 3000, cacheCreationInputTokens: 3000, costUSD: 0.0421 } },
    }),
  )
  await until(() => run.fake.inputClosed, 'the input to close')
  run.fake.exit(0)
  const { performance, ...ended } = await run.finished

  // Its timings count each of its two responses once, from their own usage.
  assert.deepEqual([performance?.responses, performance?.input, performance?.output, performance?.cacheRead, performance?.cacheWrite, performance?.estimatedUsd], [
    2,
    { value: 37, state: 'complete' },
    { value: 100, state: 'complete' },
    { value: 3000, state: 'complete' },
    { value: 3000, state: 'complete' },
    { value: 0.0421, state: 'complete' },
  ])
  const tokens = 12 + 3000 + 60 + (25 + 40)
  assert.deepEqual(ended, {
    id: RUN_ID,
    harness: 'claude',
    status: 'completed',
    text: 'Fixed: the cache test waits for its writer.',
    cost: { usd: 0.0421, kind: 'estimate', cumulative: true, sessionId: RUN_ID },
    model: `claude-code/${MODEL}`,
    effort: 'minimal',
    sessionId: RUN_ID,
    freshSession: true,
    tokens,
  })
  // Work's budget, its stall check and its identity check read the run's session as they read a Pi run's.
  assert.deepEqual(sessionUsage(run.request.sessionFile), { tokens, cached: 3000, usd: 0, sessionId: RUN_ID })
  assert.equal(followUsage(run.request.sessionFile).tokens, tokens)
  assert.equal(sessionError(run.request.sessionFile), null)
  assert.equal(statSync(run.request.sessionFile).mode & 0o777, 0o600)
})

test("a run Claude ends with an error fails in Claude's words, and its session says so", async (t) => {
  const run = launch(t)
  await until(() => run.send(), 'the run to start')
  const limit = 'Claude AI usage limit reached. Try again in 30 minutes.'
  run.fake.print(init(), { type: 'result', subtype: 'success', is_error: true, result: limit, session_id: RUN_ID, total_cost_usd: 0 })
  await until(() => run.fake.inputClosed, 'the input to close')
  run.fake.exit(1)
  const ended = await run.finished
  assert.equal(ended.status, 'failed')
  assert.equal(ended.error, limit)
  assert.equal(sessionError(run.request.sessionFile), limit, "Work's usage-limit check reads the provider's words")

  const counted = launch(t)
  await until(() => counted.send(), 'the run to start')
  counted.fake.print(init(), { type: 'result', subtype: 'error_max_turns', is_error: true, session_id: RUN_ID, total_cost_usd: 0.3 })
  await until(() => counted.fake.inputClosed, 'the input to close')
  counted.fake.exit(1)
  const stopped = await counted.finished
  assert.equal(stopped.status, 'failed')
  assert.match(stopped.error!, /error_max_turns/)
  assert.deepEqual(stopped.cost, { usd: 0.3, kind: 'estimate', cumulative: true, sessionId: RUN_ID }, 'what it spent still counts')

  const broke = launch(t)
  await until(() => broke.send(), 'the run to start')
  broke.fake.print(init(), { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['Hook PreToolUse:Bash failed: exit 2'], session_id: RUN_ID })
  await until(() => broke.fake.inputClosed, 'the input to close')
  broke.fake.exit(1)
  assert.equal((await broke.finished).error, 'Hook PreToolUse:Bash failed: exit 2')
})

test('stop interrupts and ends the run, and force kills it', async (t) => {
  // A Claude that takes the interrupt and goes: no signal is needed.
  const polite = new AbortController()
  const quick = launch(t, { request: { signal: polite.signal }, setup: { stopMs: 1000, killMs: 2000 } })
  await until(() => quick.send(), 'the run to start')
  quick.fake.print(init())
  polite.abort()
  await until(() => quick.fake.inputClosed, 'the input to close')
  assert.deepEqual(quick.fake.written.at(-1), { type: 'control_request', request_id: quick.fake.written.at(-1)!.request_id, request: { subtype: 'interrupt' } })
  assert.equal(typeof quick.fake.written.at(-1)!.request_id, 'string')
  quick.fake.print({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: RUN_ID })
  quick.fake.exit(0)
  assert.equal((await quick.finished).status, 'interrupted')
  assert.deepEqual(quick.signals, [])
  await assert.rejects(quick.send()!('Too late.'), (error: Error & { notQueued?: boolean }) => error.notQueued === true)

  // One that does not go is ended: SIGTERM after a grace, then SIGKILL.
  const stop = new AbortController()
  const stubborn = launch(t, { request: { signal: stop.signal } })
  stubborn.fake.onSignal = (signal) => signal === 'SIGKILL' && stubborn.fake.exit(null, 'SIGKILL')
  await until(() => stubborn.send(), 'the run to start')
  stubborn.fake.print(init())
  const stoppedAt = Date.now()
  stop.abort()
  const ended = await stubborn.finished
  assert.equal(ended.status, 'interrupted')
  assert.deepEqual(stubborn.signals, ['SIGTERM', 'SIGKILL'])
  assert.ok(Date.now() - stoppedAt >= 70, 'SIGKILL waits for its own time, well past the grace before SIGTERM')

  // Force sends SIGTERM at once, which Claude takes to end the Bash commands it runs in groups of their own, and SIGKILL after a short grace.
  const forced = launch(t, { setup: { forceGraceMs: 30 } })
  forced.fake.onSignal = (signal) => signal === 'SIGKILL' && forced.fake.exit(null, 'SIGKILL')
  await until(() => forced.child(), 'the control handle')
  forced.fake.print(init())
  forced.child()!.force()
  assert.deepEqual(forced.signals, ['SIGTERM'])
  assert.deepEqual(await forced.child()!.closed, { code: null, signal: 'SIGKILL' })
  assert.deepEqual(forced.signals, ['SIGTERM', 'SIGKILL'])
  assert.equal((await forced.finished).status, 'interrupted')

  // One that goes on SIGTERM is not signalled again: its group id may be another's by then.
  const obliging = launch(t, { setup: { forceGraceMs: 30 } })
  await until(() => obliging.child(), 'the control handle')
  obliging.child()!.force()
  assert.equal((await obliging.finished).status, 'interrupted')
  await delay(60)
  assert.deepEqual(obliging.signals, ['SIGTERM'])

  // Terminate asks the group to end.
  const terminated = launch(t)
  await until(() => terminated.child(), 'the control handle')
  terminated.child()!.terminate()
  await terminated.finished
  assert.deepEqual(terminated.signals, ['SIGTERM'])

  // A run stopped before it starts never starts.
  const early = new AbortController()
  early.abort()
  const never = launch(t, { request: { signal: early.signal } })
  assert.deepEqual(await never.finished, {
    id: RUN_ID,
    harness: 'claude',
    status: 'interrupted',
    text: '',
    cost: null,
    model: 'claude-code/sonnet',
    effort: 'minimal',
    sessionId: null,
    freshSession: true,
    error: 'Cancelled before dispatch.',
  })
  assert.deepEqual(never.spawned, [])

  // With its own times, a Claude that ignores the stop is gone within the five seconds a stop has.
  const ignored = new AbortController()
  const deaf = launch(t, { request: { signal: ignored.signal }, setup: { stopMs: undefined, killMs: undefined } })
  deaf.fake.onSignal = (signal) => signal === 'SIGKILL' && deaf.fake.exit(null, 'SIGKILL')
  await until(() => deaf.send(), 'the run to start')
  t.mock.timers.enable({ apis: ['setTimeout'] })
  ignored.abort()
  t.mock.timers.tick(1999)
  assert.deepEqual(deaf.signals, [])
  t.mock.timers.tick(1)
  assert.deepEqual(deaf.signals, ['SIGTERM'], 'SIGTERM two seconds after the stop')
  t.mock.timers.tick(1999)
  assert.deepEqual(deaf.signals, ['SIGTERM'])
  t.mock.timers.tick(1)
  assert.deepEqual(deaf.signals, ['SIGTERM', 'SIGKILL'], 'SIGKILL at four')
  assert.equal((await deaf.finished).status, 'interrupted')
  t.mock.timers.reset()
})

test('a claude that cannot start fails the run with its reason', async (t) => {
  // A program that is not there. Nothing starts.
  const home = temporaryDirectory(t)
  const missing = join(home, 'no-claude-here', 'claude')
  const cwd = join(home, 'project')
  mkdirSync(cwd)
  let controlled = false
  const signals: string[] = []
  const request = { id: RUN_ID, cwd, prompt: 'Fix it.', sessionFile: join(home, 'jobs', 'run.jsonl'), effort: 'high' }
  const nowhere = await runClaudeHarness(request, { onControl: () => (controlled = true) }, {
    claude: missing,
    settings: SETTINGS,
    title: TITLE,
    directions: DIRECTIONS,
    ask: async () => undefined,
    env: { PATH: '/usr/bin:/bin' },
    signalGroup: (_child, signal) => signals.push(signal),
  })
  assert.equal(nowhere.status, 'failed')
  assert.equal(nowhere.error, `Claude Code could not start: there is no program at ${missing}.`)
  assert.equal(nowhere.sessionId, null)
  assert.equal(controlled, false)
  assert.deepEqual(signals, [])

  // One that quits before it finishes says why, in its own last words.
  const quits = launch(t)
  await until(() => quits.send(), 'the run to start')
  quits.fake.stderr.write('Invalid API key · Please run /login\n')
  quits.fake.exit(1)
  const quit = await quits.finished
  assert.equal(quit.status, 'failed')
  assert.equal(quit.error, 'Claude Code exited with code 1 before finishing: Invalid API key · Please run /login')

  // After its session began, the session records it too.
  const begun = launch(t)
  await until(() => begun.send(), 'the run to start')
  begun.fake.print(init())
  await until(() => statSync(begun.request.sessionFile, { throwIfNoEntry: false }), 'the session file')
  begun.fake.exit(null, 'SIGSEGV')
  const crashed = await begun.finished
  assert.equal(crashed.error, 'Claude Code was ended by SIGSEGV before finishing.')
  assert.equal(sessionError(begun.request.sessionFile), crashed.error)
  assert.equal(sessionUsage(begun.request.sessionFile).sessionId, RUN_ID)
})

test('what Claude prints is bounded: an outsized record is left out and the run goes on', async (t) => {
  const run = launch(t)
  await until(() => run.send(), 'the run to start')
  const reply = (id: string, text: string) => ({ type: 'assistant', message: { id, role: 'assistant', model: MODEL, content: [{ type: 'text', text }], usage: usage(1, 1) }, parent_tool_use_id: null, session_id: RUN_ID })
  run.fake.print(init(), reply('msg_big', 'x'.repeat(9 * 1024 * 1024)), reply('msg_ok', 'Still here.'))
  run.fake.stderr.write(`${'noise\n'.repeat(2000)}the last words`)
  run.fake.exit(1)
  const ended = await run.finished
  const said = run.events.filter((event) => event.type === 'message_end').map((event) => event.message.content[0].text)
  assert.deepEqual(said, ['Still here.'])
  assert.ok(ended.error!.endsWith('the last words') && ended.error!.length < 1600, 'only the end of what it printed to stderr')
})

test("Claude's questions and permission prompts are answered on the sheet one at a time", async (t) => {
  const asks: { request: AskRequest; signal: AbortSignal | undefined; answer: (value: QuestionAnswer) => void }[] = []
  // As the sheet does, a question withdrawn while it is up resolves as put off.
  const ask: Ask = (request, signal) => new Promise((answer) => {
    asks.push({ request, signal, answer })
    signal?.addEventListener('abort', () => answer(null), { once: true })
  })
  const run = launch(t, { setup: { ask } })
  await until(() => run.send(), 'the run to start')
  run.fake.print(init(), canUseTool('req-1', 'Bash', { command: 'npm test' }), canUseTool('req-2', 'Edit', { file_path: '/work/a.ts', old_string: 'a', new_string: 'b' }))
  await until(() => asks.length === 1, 'the first question')
  await delay(20)
  assert.equal(asks.length, 1, 'one question at a time')
  assert.deepEqual([asks[0]!.request.question, asks[0]!.request.from], ['Run `npm test`?', TITLE])

  asks[0]!.answer('allow')
  await until(() => answerTo(run.fake.written, 'req-1'), 'the answer to Claude')
  assert.deepEqual(answerTo(run.fake.written, 'req-1'), {
    type: 'control_response',
    response: { subtype: 'success', request_id: 'req-1', response: { behavior: 'allow', updatedInput: { command: 'npm test' } } },
  })

  // Claude withdraws the next: it leaves the sheet and nothing goes back.
  await until(() => asks.length === 2, 'the second question')
  run.fake.print({ type: 'control_cancel_request', request_id: 'req-2' })
  await until(() => asks[1]!.signal?.aborted, 'the question to be withdrawn')

  // A request this host does not serve is refused at once, so Claude never waits on it.
  run.fake.print({ type: 'control_request', request_id: 'req-3', request: { subtype: 'mcp_message', server_name: 'tracker', message: {} } })
  await until(() => answerTo(run.fake.written, 'req-3'), 'the refusal')
  assert.deepEqual(answerTo(run.fake.written, 'req-3'), { type: 'control_response', response: { subtype: 'error', request_id: 'req-3', error: 'Unsupported control request: mcp_message' } })
  assert.equal(answerTo(run.fake.written, 'req-2'), undefined)

  // Once the run takes nothing more, a question still up goes away: its answer could not reach Claude.
  run.fake.print(canUseTool('req-4', 'Bash', { command: 'git push' }))
  await until(() => asks.length === 3, 'the third question')
  run.fake.print(result('Done.'))
  await until(() => asks[2]!.signal?.aborted, 'the last question to go')
  run.fake.exit(0)
  assert.equal((await run.finished).status, 'completed')
  assert.equal(answerTo(run.fake.written, 'req-4'), undefined)
})

/** Every event in hobkin's event log under a data root, without the time it was written. */
function loggedEvents(root: string): Line[] {
  const folder = join(root, 'runtime', 'events')
  return readdirSync(folder).flatMap((file) => readFileSync(join(folder, file), 'utf8').trim().split('\n').map((line) => {
    const { at, ...event } = JSON.parse(line)
    assert.ok(Number.isFinite(Date.parse(at)))
    return event
  }))
}

test("a turn's timings come back on its result and go once into hobkin's event log", async (t) => {
  const root = temporaryDirectory(t)
  const since = Date.now() - 50
  const run = launch(t, { options: { metricsRoot: root, turn: { since, origin: 'window', kind: 'main', marks: { host: since + 10, admitted: since + 40 } } } })
  await until(() => run.send(), 'the prompt')
  const stream = (event: Line) => ({ type: 'stream_event', event, parent_tool_use_id: null, session_id: RUN_ID })
  run.fake.print(
    init(),
    replay('Fix the flaky cache test.'),
    stream({ type: 'message_start', message: { id: 'msg_1', model: MODEL, usage: usage(12, 1) } }),
    stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Fixed.' } }),
    { type: 'assistant', message: { id: 'msg_1', role: 'assistant', model: MODEL, content: [{ type: 'text', text: 'Fixed.' }], usage: usage(12, 1) }, parent_tool_use_id: null, session_id: RUN_ID },
    stream({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } }),
    stream({ type: 'message_stop' }),
    result('Fixed.', { duration_api_ms: 900 }),
  )
  await until(() => run.fake.inputClosed, 'the input to close')
  run.fake.exit(0)
  const ended = await run.finished
  assert.equal(ended.status, 'completed')
  const { stages, firstObservedOutputMs, dispatchElapsedMs, ...facts } = ended.performance!
  // The responses one by one are in the event only.
  assert.equal('steps' in ended.performance!, false)
  const [{ steps }] = loggedEvents(root) as unknown as [{ steps: Record<'at' | 'first' | 'text' | 'end' | 'input' | 'cacheRead' | 'output', number | null>[] }]

  assert.deepEqual(facts, {
    schemaVersion: 1,
    runId: RUN_ID,
    sessionId: RUN_ID,
    responses: 1,
    incomplete: false,
    input: { value: 12, state: 'complete' },
    output: { value: 8, state: 'complete' },
    cacheRead: { value: 0, state: 'complete' },
    cacheWrite: { value: 0, state: 'complete' },
    estimatedUsd: { value: 0.01, state: 'complete' },
    responseDurationMs: { value: 900, state: 'complete' },
    kind: 'main',
    engine: 'claude',
    model: MODEL,
    effort: 'low',
    origin: 'window',
  })
  // Each moment is ms since the turn began, in the order a turn goes.
  const order = ['host', 'admitted', 'spawned', 'prompted', 'ready', 'requested', 'text', 'ended'] as const
  assert.deepEqual(Object.keys(stages).sort(), [...order].sort())
  assert.deepEqual([stages.host, stages.admitted], [10, 40])
  const times = order.map((stage) => stages[stage]!)
  assert.deepEqual(times, [...times].sort((a, b) => a - b))
  assert.ok(stages.spawned! >= 50, 'the turn began before the harness did')
  assert.ok(firstObservedOutputMs !== null && dispatchElapsedMs !== null && firstObservedOutputMs <= dispatchElapsedMs)
  assert.deepEqual(steps.map(({ input, cacheRead, output }) => [input, cacheRead, output]), [[12, 0, 8]])
  assert.ok(steps.every((step) => [step.at, step.first, step.text, step.end].every((at) => typeof at === 'number' && at >= 0)))

  assert.deepEqual(loggedEvents(root), [{ type: 'run_performance', ...ended.performance, steps }])
  const folder = join(root, 'runtime', 'events')
  assert.doesNotMatch(readFileSync(join(folder, readdirSync(folder)[0]!), 'utf8'), /Fixed|flaky/, 'nothing the model or the user wrote')
})

test('a stopped turn still records what it measured, and a log that cannot be written fails nothing', async (t) => {
  const root = temporaryDirectory(t)
  const stop = new AbortController()
  const stopped = launch(t, { request: { signal: stop.signal }, options: { metricsRoot: root } })
  await until(() => stopped.send(), 'the run to start')
  stopped.fake.print(init())
  await until(() => statSync(stopped.request.sessionFile, { throwIfNoEntry: false }), 'the session to begin')
  stop.abort()
  const ended = await stopped.finished
  assert.equal(ended.status, 'interrupted')
  assert.deepEqual([ended.performance?.incomplete, ended.performance?.origin, ended.performance?.kind, ended.performance?.responses], [true, 'run', 'work', 0])
  assert.deepEqual(Object.keys(ended.performance!.stages), ['spawned', 'prompted', 'ready', 'ended'])
  assert.deepEqual(loggedEvents(root), [{ type: 'run_performance', ...ended.performance, steps: [] }])

  // A data root that is a file takes no event, and the turn goes on as ever.
  const blocked = join(temporaryDirectory(t), 'a-file')
  writeFileSync(blocked, '')
  const run = launch(t, { options: { metricsRoot: blocked } })
  await until(() => run.send(), 'the run to start')
  run.fake.print(init(), result('Done.'))
  await until(() => run.fake.inputClosed, 'the input to close')
  run.fake.exit(0)
  const done = await run.finished
  assert.equal(done.status, 'completed')
  assert.equal(done.performance?.runId, RUN_ID)
})
