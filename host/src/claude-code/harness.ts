import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Readable } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import { recordEvent } from 'hobkin/src/cli/events.mjs'
import { PERMISSION_MODE, type ClaudeCodeSettings } from '#shared/protocol/claude-code.ts'
import type { Ask } from '../questions.ts'
import { answerToolRequest, type ToolRequest } from './asking.ts'
import { ClaudeStream, type ClaudeRecord, type PiEvent, type SessionLine } from './stream.ts'
import { turnTiming, type TurnContext, type TurnFacts, type TurnTiming } from './timing.ts'

/**
 * One of hobkin's agent runs on the installed `claude` CLI, headless (`033-claude-code-agents`). It takes the request,
 * callbacks and result of hobkin's Pi harness (`runHarness` in its `src/cli/harnesses.mjs`), so hobkin cannot tell the
 * two apart. Claude reads user messages on stdin and prints its stream on stdout, one JSON record per line, and it asks
 * for its questions and permission prompts over the same pipes.
 */

export interface ClaudeHarnessRequest {
  id: string
  cwd: string
  prompt: string
  sessionFile: string
  /** The Claude session an earlier turn of a durable hobkin started. Claude continues it instead of starting one. */
  resume?: string
  effort?: string
  purpose?: string
  /** The routine a scheduled run belongs to, when hobkin names it. */
  scheduleId?: string
  signal?: AbortSignal
}

/** What hobkin holds to force a run: the process ends, and how. */
export interface ClaudeChild {
  closed: Promise<{ code: number | null; signal: string | null }>
  force(): void
  terminate(): void
}

export interface ClaudeHarnessOptions {
  onEvent?: (event: Record<string, unknown>) => void
  onReady?: (send: (message: string) => Promise<{ disposition: 'queued' }>) => void
  onControl?: (child: ClaudeChild) => void
  /** hobkin's data root: the turn's timings go in its event log. */
  metricsRoot?: string
  /** What the runtime knows of the turn before it reached the harness. */
  turn?: TurnContext
}

type Signal = 'SIGTERM' | 'SIGKILL'

export interface ClaudeRunSetup {
  /** The claude program. */
  claude: string
  settings: ClaudeCodeSettings
  /** Who asks on the question sheet: the run's title. */
  title: string
  /** hobkin's directions for this run, added to Claude's own system prompt. */
  directions: string
  ask: Ask
  spawnProcess?: typeof spawn
  env?: NodeJS.ProcessEnv
  /** Signals the run's process group. */
  signalGroup?: (child: ChildProcess, signal: Signal) => void
  /** After a stop, how long Claude has to end by itself before SIGTERM, and before SIGKILL. */
  stopMs?: number
  killMs?: number
  /** After a force, how long Claude has to end its commands between SIGTERM and SIGKILL. */
  forceGraceMs?: number
  askRetryMs?: number
  askGiveUpMs?: number
}

export interface ClaudeHarnessResult {
  id: string
  harness: 'claude'
  status: 'completed' | 'failed' | 'interrupted'
  text: string
  cost: { usd: number; kind: 'estimate'; cumulative: true; sessionId: string } | null
  model: string
  effort: string | undefined
  sessionId: string | null
  freshSession: true
  tokens?: number
  error?: string
  /** When each moment of the turn came, and what it spent: hobkin's `run_performance` facts. The event also lists each response. */
  performance?: Omit<TurnFacts, 'steps'>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_LINE_BYTES = 8 * 1024 * 1024
const NEWLINE = 0x0a
const MAX_STDERR = 4096
const MAX_ERROR = 2000
// Claude Code's levels for a tier's. It has nothing below low.
const EFFORTS = new Map([
  ['off', 'low'],
  ['minimal', 'low'],
  ['low', 'low'],
  ['medium', 'medium'],
  ['high', 'high'],
  ['xhigh', 'xhigh'],
  ['max', 'max'],
])

const clean = (value: unknown) => stripVTControlCharacters(String(value ?? '')).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const later = (run: () => void, ms: number) => {
  const timer = setTimeout(run, ms)
  timer.unref()
  return timer
}

const signalGroup = (child: ChildProcess, signal: Signal) => {
  if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal)
  else child.kill(signal)
}

// A host that exits leaves no agent behind: each still running gets SIGTERM with its group. Exit cannot wait to follow
// it with SIGKILL, and SIGTERM is what lets Claude end its Bash commands.
const live = new Set<() => void>()
let reaping = false
function killAtExit(kill: () => void): () => void {
  live.add(kill)
  if (!reaping) {
    reaping = true
    process.once('exit', () => {
      for (const each of live) each()
    })
  }
  return () => live.delete(kill)
}

/** The `--effort` level Claude Code runs at, or undefined for its own. */
const levelOf = (effort: ClaudeCodeSettings['effort'], request: ClaudeHarnessRequest) => (effort === 'tier' ? EFFORTS.get(request.effort ?? '') : effort)

function claudeArguments({ model, effort, permissions }: ClaudeCodeSettings, request: ClaudeHarnessRequest, sessionId: string, directions: string): string[] {
  const level = levelOf(effort, request)
  return [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--replay-user-messages',
    '--permission-prompt-tool', 'stdio',
    '--permission-mode', PERMISSION_MODE[permissions],
    ...(request.resume ? ['--resume', request.resume] : ['--session-id', sessionId]),
    ...(directions ? ['--append-system-prompt', directions] : []),
    ...(model === 'default' ? [] : ['--model', model]),
    ...(level ? ['--effort', level] : []),
  ]
}

/** A user message for Claude's input. Its own id lets Claude acknowledge it even when it merges it with others. */
const userMessage = (text: string, sessionId: string) => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'text', text }] },
  parent_tool_use_id: null,
  session_id: sessionId,
  uuid: randomUUID(),
})

/** Calls back with each line. A line past the bound is left out, and reading goes on. */
function readLines(stream: Readable, onLine: (line: string) => void): void {
  let parts: Buffer[] = []
  let size = 0
  let dropping = false
  const endLine = () => {
    if (!dropping && size) onLine(Buffer.concat(parts, size).toString('utf8'))
    parts = []
    size = 0
    dropping = false
  }
  stream.on('data', (chunk: Buffer) => {
    let start = 0
    while (start <= chunk.length) {
      const newline = chunk.indexOf(NEWLINE, start)
      const stop = newline === -1 ? chunk.length : newline
      if (!dropping) {
        size += stop - start
        if (size > MAX_LINE_BYTES) {
          dropping = true
          parts = []
        } else if (stop > start) parts.push(chunk.subarray(start, stop))
      }
      if (newline === -1) return
      endLine()
      start = newline + 1
    }
  })
  stream.on('end', endLine)
}

/**
 * Appends to the run's session file, private to the user. A file that already holds lines is an earlier turn's of the
 * same durable hobkin: it keeps its one header, so this turn adds everything but another.
 */
function sessionWriter(file: string): (lines: SessionLine[]) => void {
  let made = false
  const continued = (() => {
    try {
      return !!file && statSync(file).size > 0
    } catch {
      return false
    }
  })()
  return (all) => {
    const lines = continued ? all.filter((line) => line.type !== 'session') : all
    if (!lines.length || !file) return
    try {
      if (!made) mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
      made = true
      appendFileSync(file, lines.map((line) => `${JSON.stringify(line)}\n`).join(''), { mode: 0o600 })
    } catch {
      // The run goes on. Work then finds no usage for it, and its identity check marks it.
    }
  }
}

function startFailure(error: unknown, claude: string, cwd: string): string {
  const code = (error as NodeJS.ErrnoException | null)?.code
  const why = code === 'ENOENT'
    ? (existsSync(cwd) ? `there is no program at ${claude}.` : `the folder ${cwd} is not there.`)
    : clean((error as Error | null)?.message ?? error)
  return `Claude Code could not start: ${why}`
}

function exitedEarly({ code, signal }: { code: number | null; signal: string | null }, stderr: string): string {
  const said = clean(stderr).trim().slice(-1500)
  const how = signal ? `was ended by ${signal}` : `exited with code ${code}`
  return `Claude Code ${how} before finishing${said ? `: ${said}` : '.'}`
}

/** How a run ended, by its last result. Claude's own words for a failure are what Work's usage-limit check reads. */
function outcome(last: ClaudeRecord): { text: string } | { error: string } {
  const said = typeof last.result === 'string' ? clean(last.result).trim() : ''
  if (last.subtype === 'success' && last.is_error !== true) {
    return said ? { text: clean(last.result) } : { error: 'Claude Code finished without a final answer.' }
  }
  // A run that broke down carries no result text, only what went wrong.
  const errors = Array.isArray(last.errors)
    ? last.errors.filter((error) => typeof error === 'string').map(clean).join('\n').trim()
    : ''
  return { error: said || errors || `Claude Code stopped without finishing (${clean(last.subtype) || 'no reason given'}).` }
}

/** The turn's timings go on its result and, given hobkin's data root, into its event log. Neither can fail the turn. */
function timed(result: ClaudeHarnessResult, timing: TurnTiming, root: string | undefined): ClaudeHarnessResult {
  try {
    const facts = timing.facts()
    if (!facts) return result
    if (root) recordEvent(root, 'run_performance', facts)
    // The responses one by one go in the event only, as on Pi: a run keeps its facts for good.
    const { steps: _steps, ...performance } = facts
    return { ...result, performance }
  } catch {
    return result
  }
}

/** Runs one request on Claude Code. It never throws for the run itself: how the run went is in the result. */
export async function runClaudeHarness(request: ClaudeHarnessRequest, options: ClaudeHarnessOptions = {}, setup: ClaudeRunSetup): Promise<ClaudeHarnessResult> {
  const { settings } = setup
  const timing = turnTiming({
    runId: request.id,
    purpose: request.purpose,
    scheduleId: request.scheduleId,
    model: settings.model === 'default' ? null : settings.model,
    effort: levelOf(settings.effort, request) ?? null,
    turn: options.turn,
  })
  return timed(await runTurn(request, options, setup, timing), timing, options.metricsRoot)
}

async function runTurn(request: ClaudeHarnessRequest, options: ClaudeHarnessOptions, setup: ClaudeRunSetup, timing: TurnTiming): Promise<ClaudeHarnessResult> {
  const { onEvent = () => {}, onReady = () => {}, onControl = () => {} } = options
  // A stop ends the run within five seconds (A10): SIGTERM at two, SIGKILL at four.
  const { settings, stopMs = 2000, killMs = 4000, forceGraceMs = 1000 } = setup
  const result: ClaudeHarnessResult = {
    id: request.id,
    harness: 'claude',
    status: 'failed',
    text: '',
    cost: null,
    model: `claude-code/${settings.model}`,
    effort: request.effort,
    sessionId: null,
    freshSession: true,
  }
  if (request.signal?.aborted) return { ...result, status: 'interrupted', error: 'Cancelled before dispatch.' }

  if (request.resume !== undefined && !UUID.test(request.resume)) return { ...result, error: 'The Claude session to continue is not a valid session id.' }
  const sessionId = request.resume ?? (UUID.test(request.id) ? request.id : randomUUID())
  // Set when a Claude Code session started the host. This run is a session of its own, not that one's child.
  const { CLAUDECODE: _code, CLAUDE_CODE_ENTRYPOINT: _entry, ...env } = setup.env ?? process.env
  let child: ChildProcess
  try {
    child = (setup.spawnProcess ?? spawn)(setup.claude, claudeArguments(settings, request, sessionId, setup.directions), {
      cwd: request.cwd,
      env,
      // Its own process group, so a signal reaches Claude and what it starts in that group. Claude starts its Bash
      // commands in groups of their own and ends them itself on SIGTERM, so every way to end a run sends SIGTERM first.
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    })
  } catch (error) {
    return { ...result, error: startFailure(error, setup.claude, request.cwd) }
  }

  const stream = new ClaudeStream({ cwd: request.cwd })
  const record = sessionWriter(request.sessionFile)
  const signalAll = setup.signalGroup ?? signalGroup
  const timers: NodeJS.Timeout[] = []
  const asking = new Map<string, AbortController>()
  let queue = Promise.resolve()
  let exited = false
  let inputOpen = true
  let takesMessages = false
  let stopping = false
  let forced = false
  let failure: unknown = null
  let stderr = ''
  let unwatch = () => {}

  // Exit revokes the right to signal the group: its id may belong to another process by then.
  const kill = (signal: Signal) => {
    if (exited) return
    try {
      signalAll(child, signal)
    } catch {
      // Already gone.
    }
  }
  const closed = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    let done = false
    const finish = (code: number | null, signal: string | null) => {
      if (done) return
      done = true
      exited = true
      inputOpen = false
      takesMessages = false
      for (const timer of timers) clearTimeout(timer)
      for (const controller of asking.values()) controller.abort()
      unwatch()
      resolve({ code, signal })
    }
    child.on('error', (error) => {
      if (child.pid !== undefined) return
      failure = error
      finish(null, null)
    })
    child.once('exit', (code, signal) => {
      exited = true
      // Close waits for its output to end. Something it left behind could hold that open.
      timers.push(later(() => {
        child.stdout?.destroy()
        child.stderr?.destroy()
        finish(code, signal)
      }, 1000))
    })
    child.once('close', (code, signal) => finish(code, signal))
  })
  if (child.pid === undefined) {
    await closed
    return { ...result, error: startFailure(failure, setup.claude, request.cwd) }
  }
  timing.spawned(sessionId)
  unwatch = killAtExit(() => kill('SIGTERM'))

  const write = (line: object) => {
    if (inputOpen && child.stdin?.writable) child.stdin.write(`${JSON.stringify(line)}\n`)
  }
  // An answer can no longer reach Claude, so a question still up for it goes away.
  const endInput = () => {
    if (!inputOpen) return
    inputOpen = false
    takesMessages = false
    child.stdin?.end()
    for (const controller of asking.values()) controller.abort()
  }
  const respond = (response: Record<string, unknown>) => write({ type: 'control_response', response })
  const emit = (events: PiEvent[]) => {
    for (const event of events) {
      try {
        onEvent(event)
      } catch {
        // What is drawn must not fail the run.
      }
    }
  }

  const askingSetup = { ask: setup.ask, from: setup.title, retryMs: setup.askRetryMs, giveUpMs: setup.askGiveUpMs }
  // Claude waits on each of these, so every one gets an answer, one question at a time, unless Claude withdraws it.
  const control = (line: ClaudeRecord) => {
    const id = typeof line.request_id === 'string' ? line.request_id : ''
    const body = isRecord(line.request) ? line.request : {}
    if (!id) return
    if (body.subtype !== 'can_use_tool') return respond({ subtype: 'error', request_id: id, error: `Unsupported control request: ${clean(body.subtype)}` })
    if (!inputOpen) return
    const controller = new AbortController()
    asking.set(id, controller)
    queue = queue
      .then(async () => {
        if (controller.signal.aborted) return
        try {
          const reply = await answerToolRequest(body as ToolRequest, askingSetup, controller.signal)
          if (reply && !controller.signal.aborted) respond({ subtype: 'success', request_id: id, response: reply })
        } catch {
          if (!controller.signal.aborted) respond({ subtype: 'error', request_id: id, error: 'The question could not be asked.' })
        }
      })
      .finally(() => asking.delete(id))
  }

  const take = (line: ClaudeRecord) => {
    timing.observe(line)
    if (line.type === 'control_request') return control(line)
    if (line.type === 'control_cancel_request') return asking.get(String(line.request_id))?.abort()
    if (line.type === 'control_response') return
    const { events, lines } = stream.accept(line)
    record(lines)
    emit(events)
    // The first result ends the run's taking messages. With its input closed, Claude finishes what it queued and exits.
    if (line.type === 'result') endInput()
  }
  if (child.stdout) {
    readLines(child.stdout, (text) => {
      try {
        const line: unknown = JSON.parse(text)
        if (isRecord(line)) take(line)
      } catch {
        // A record this cannot read is left out. Throwing here would take the host down with it.
      }
    })
  }
  child.stderr?.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-MAX_STDERR)
  })
  // Claude gone breaks its input pipe. How the run ended says why.
  child.stdin?.on('error', () => {})

  const stop = () => {
    if (stopping || exited) return
    stopping = true
    write({ type: 'control_request', request_id: `hobkin-${randomUUID()}`, request: { subtype: 'interrupt' } })
    endInput()
    timers.push(
      later(() => kill('SIGTERM'), stopMs),
      later(() => kill('SIGKILL'), killMs),
    )
  }
  request.signal?.addEventListener('abort', stop, { once: true })
  const handle: ClaudeChild = {
    closed,
    force: () => {
      if (exited) return
      forced = true
      endInput()
      kill('SIGTERM')
      timers.push(later(() => kill('SIGKILL'), forceGraceMs))
    },
    terminate: () => kill('SIGTERM'),
  }

  try {
    onControl(handle)
  } catch (error) {
    endInput()
    kill('SIGTERM')
    timers.push(later(() => kill('SIGKILL'), killMs))
    await closed
    request.signal?.removeEventListener('abort', stop)
    return { ...result, error: clean((error as Error | null)?.message ?? error).slice(0, MAX_ERROR) }
  }
  if (!stopping && !forced && !exited) {
    write(userMessage(request.prompt, sessionId))
    timing.prompted()
    takesMessages = true
    try {
      onReady(async (message) => {
        if (!takesMessages) throw Object.assign(Error('That check has finished.'), { notQueued: true })
        write(userMessage(message, sessionId))
        return { disposition: 'queued' as const }
      })
    } catch {
      // The run goes on without taking messages.
    }
  }

  const ended = await closed
  request.signal?.removeEventListener('abort', stop)
  const rest = stream.end()
  record(rest.lines)
  emit(rest.events)

  result.sessionId = stream.sessionId
  if (stream.model) result.model = `claude-code/${stream.model}`
  if (stream.sessionId) result.tokens = stream.tokens
  const last = stream.result
  const usd = last?.total_cost_usd
  const costSession = stream.sessionId ?? (typeof last?.session_id === 'string' ? last.session_id : null)
  if (typeof usd === 'number' && Number.isFinite(usd) && usd >= 0 && costSession) {
    result.cost = { usd, kind: 'estimate', cumulative: true, sessionId: costSession }
  }

  if (stopping || forced) {
    result.status = 'interrupted'
    result.error = 'Claude Code was stopped before it finished.'
    return result
  }
  const ending = last ? outcome(last) : { error: exitedEarly(ended, stderr) }
  if ('text' in ending) {
    result.status = 'completed'
    result.text = ending.text
    return result
  }
  result.error = ending.error.slice(0, MAX_ERROR)
  const said = stream.failed(result.error)
  if (said) record([said])
  return result
}
