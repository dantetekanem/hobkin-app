/**
 * The agent-open lab, run by `scripts/perf/agent-open.ts` in a process of its own: the real host (`startHost`, port 0,
 * scripted, backups off) on a temporary home, with long synthetic conversations, and a fake window (`open-window.ts`,
 * another process) that opens agents' pages the way the window does.
 *
 * Seeding (`--seed`) writes, through hobkin's own runtime: finished background runs with reports (as `lab.ts` seeds),
 * durable hobkin A with `--turns` turns and hobkin B with `--b-turns`, each turn 5 to 30 tool calls (long bash output,
 * file reads, edits with diffs, writes) and a long Markdown answer. The runtime records each turn as it does any; the
 * lab's harness writes what Pi would save to the hobkin's conversation (`hobkins/<id>.jsonl`): a Pi session header,
 * then each message as an entry naming its parent, so `run-steps.mjs` reads it as it reads Pi's.
 *
 * Measuring starts a busy work run that has made `--work-calls` tool calls (its feed holds the newest 200, its session
 * `jobs/<harnessId>.jsonl` all of them), then the window opens hobkin A cold and again, B, A once more, the busy run's
 * page and its older steps, watches the run streaming with and without older pages held, then sends A a working turn.
 * Last it times the runtime's readers one at a time in this process, through the host's own handlers.
 *
 * The seam, as in `lab.ts`: `HobkinApplication.open` gets this lab's harness, loaded from the module the host itself
 * imports (`host/src/owner.ts`), never by a path to the runtime. Host times come from the host's own socket: a command's
 * time runs from its message arriving to its result being sent, and a watch's covers the messages it sends at once.
 *
 * Usage: node open-lab.ts --seed --home <dir> --backups <dir> [--turns N] [--b-turns N] [--runs N]
 *        node open-lab.ts --home <dir> --backups <dir> [--work-calls N] [--seconds S] [--live-calls N] [--profile <dir>]
 * It prints one line of JSON on stdout: the result, and the processes it started.
 */
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, fstatSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { fork } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { Session } from 'node:inspector/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { WebSocket } from 'ws'
import { DEV_UI_ORIGIN } from '../../../host/src/access.ts'
import { startHost, type RunningHost } from '../../../host/src/host.ts'
import { olderStepsHandlers } from '../../../host/src/older-steps.ts'
import { descendants, type Running } from './processes.ts'

const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(name)
const value = (name: string, fallback: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1]! : fallback)
const SEED = flag('--seed')
const HOME = value('--home', '')
const BACKUPS = value('--backups', '')
const TURNS = Number(value('--turns', '300'))
const B_TURNS = Number(value('--b-turns', '40'))
const RUNS = Number(value('--runs', '700'))
const WORK_CALLS = Number(value('--work-calls', '2000'))
const SECONDS = Number(value('--seconds', '15'))
const LIVE_CALLS = Number(value('--live-calls', '30'))
const PROFILE = value('--profile', '')

const log = (line: string) => process.stderr.write(`[agent-open ${SEED ? 'seed' : 'run'}] ${line}\n`)

// Safety: the home is under the system temp folder or this session's scratchpad, never a real home, and never the live port.
const roots = [realpathSync(tmpdir()), realpathSync('/private/tmp')]
const inside = (path: string) => Boolean(path) && roots.some((root) => realpathSync(dirname(path)).startsWith(root + sep))
if (!inside(HOME) || !inside(BACKUPS) || HOME.startsWith(join(homedir(), '.hobkin'))) throw Error(`Refusing a home outside the temp folders: ${HOME}`)
if (!process.env.PI_CODING_AGENT_DIR || !inside(process.env.PI_CODING_AGENT_DIR)) throw Error('PI_CODING_AGENT_DIR must be a temporary folder.')

// ---------- the runtime, as the host loads it ----------
const ownerFile = fileURLToPath(new URL('../../../host/src/owner.ts', import.meta.url))
const applicationSpecifier = /import\('([^']*application\.mjs)'\)/.exec(readFileSync(ownerFile, 'utf8'))?.[1]
if (!applicationSpecifier) throw Error('host/src/owner.ts no longer imports the application module the way this lab expects.')
const applicationUrl = applicationSpecifier.startsWith('.') ? new URL(applicationSpecifier, pathToFileURL(ownerFile)).href : applicationSpecifier
const { HobkinApplication } = (await import(applicationUrl)) as { HobkinApplication: { open: (root: string, options: Record<string, unknown>) => Promise<unknown> } }
/** Where the runtime's code was read from, for the report. */
const runtimePath = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.resolve(applicationUrl)))
  } catch {
    return applicationUrl
  }
})()

// ---------- synthetic content ----------
let seed = 42
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1))
const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!
const WORDS = 'the host reads each report and sends only what changed so the window draws less while agents work through the queue of items in every project feed step page turn session file'.split(' ')
const IDENTS = ['readTurn', 'activityOf', 'stateSync', 'feedSteps', 'olderPages', 'windowView', 'hostFacts', 'runSteps', 'savedBranch', 'turnEntries']
const words = (count: number) => Array.from({ length: count }, () => pick(WORDS)).join(' ')
const sentence = () => `${words(between(8, 18))}.`
const fill = (bytes: number, line: () => string) => {
  const out: string[] = []
  let size = 0
  while (size < bytes) {
    const next = line()
    out.push(next)
    size += next.length + 1
  }
  return out.join('\n')
}
const size = (shares: readonly [number, number, number][]) => {
  const r = random()
  let at = 0
  for (const [share, low, high] of shares) {
    at += share
    if (r < at) return between(low, high)
  }
  return between(shares.at(-1)![1], shares.at(-1)![2])
}
const codeLine = () => pick([
  `export function ${pick(IDENTS)}(${pick(IDENTS)}: string, limit = ${between(1, 400)}): number {`,
  `  const ${pick(IDENTS)} = await ${pick(IDENTS)}.read({ job, before: ${pick(IDENTS)}.id })`,
  `  if (!${pick(IDENTS)}) return null // ${words(6)}`,
  `  return ${pick(IDENTS)}.filter((entry) => entry.id !== ${pick(IDENTS)}).map(${pick(IDENTS)})`,
  '}',
  '',
  `/** ${sentence()} */`,
])
const bashLine = () => pick([
  `  ✔ ${words(4)} (${between(1, 900)}.${between(10, 99)}ms)`,
  `▶ host/test/${pick(IDENTS)}.test.ts`,
  `    at ${pick(IDENTS)} (file:///Users/someone/project/host/src/${pick(IDENTS)}.ts:${between(1, 900)}:${between(1, 80)})`,
  `npm warn ${words(7)}`,
  `ℹ tests ${between(1, 3000)} pass ${between(1, 3000)} fail 0`,
  `src/${pick(IDENTS)}.ts(${between(1, 500)},${between(1, 60)}): error TS2345: ${sentence()}`,
])
const diffLines = (bytes: number) => `@@ -${between(1, 400)},${between(3, 30)} +${between(1, 400)},${between(3, 30)} @@\n${fill(bytes, () => `${pick(['+', '-', ' '])}${codeLine()}`)}`
const markdown = (bytes: number) => fill(bytes, () => pick([
  `## ${words(between(2, 5))}`,
  sentence() + ' ' + sentence() + ' ' + sentence(),
  `- **${pick(IDENTS)}**: ${sentence()}`,
  `- \`host/src/${pick(IDENTS)}.ts:${between(1, 900)}\` ${sentence()}`,
  `| ${pick(IDENTS)} | ${between(1, 900)} ms | ${words(4)} |`,
  '```ts\n' + fill(between(80, 400), codeLine) + '\n```',
]))

interface ToolCall { name: string; args: Record<string, unknown>; output: string; details?: Record<string, unknown> }

/** One tool call as a coding agent makes them: mostly bash and reads, with edits, writes and searches. */
function toolCall(): ToolCall {
  const path = `host/src/${pick(IDENTS)}.ts`
  const r = random()
  if (r < 0.35) return { name: 'bash', args: { command: `pnpm -s test ${path} 2>&1 | tail -n ${between(20, 400)}` }, output: fill(size([[0.6, 800, 4000], [0.3, 4000, 16000], [0.1, 16000, 60000]]), bashLine) }
  if (r < 0.65) return { name: 'read', args: { path, offset: between(1, 300), limit: between(50, 400) }, output: fill(between(2000, 20000), codeLine) }
  if (r < 0.85) {
    const oldText = fill(between(300, 2000), codeLine)
    const newText = fill(between(300, 2000), codeLine)
    return { name: 'edit', args: { path, oldText, newText }, output: `Successfully replaced text in ${path}.`, details: { diff: diffLines(between(1000, 4000)), firstChangedLine: between(1, 400) } }
  }
  if (r < 0.95) return { name: 'write', args: { path, content: fill(between(2000, 10000), codeLine) }, output: `Successfully wrote ${between(2000, 10000)} bytes to ${path}` }
  return { name: 'grep', args: { pattern: pick(IDENTS), path: 'host/src' }, output: fill(between(500, 6000), () => `${path}:${between(1, 900)}: ${codeLine()}`) }
}

// ---------- Pi's saved session ----------
/** The last entry's id in each session file this lab writes to, so each new entry names it as its parent. */
const lastIds = new Map<string, string | null>()

function lastIdOf(file: string): string | null {
  if (lastIds.has(file)) return lastIds.get(file)!
  if (!existsSync(file)) return null
  // The newest line is within the file's last few hundred kilobytes.
  const handle = openSync(file, 'r')
  try {
    const length = fstatSync(handle).size
    const take = Math.min(length, 512 * 1024)
    const buffer = Buffer.alloc(take)
    readSync(handle, buffer, 0, take, length - take)
    const line = buffer.toString('utf8').trimEnd().split('\n').at(-1)!
    return (JSON.parse(line) as { id?: string }).id ?? null
  } finally {
    closeSync(handle)
  }
}

/** Pi's way of saving a message as it ends: one entry naming the one before, after a session header in a new file. */
function save(file: string, message: Record<string, unknown>, cwd: string) {
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    writeFileSync(file, `${JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd })}\n`, { mode: 0o600 })
    lastIds.set(file, null)
  }
  const id = randomBytes(4).toString('hex')
  const at = Date.now()
  appendFileSync(file, `${JSON.stringify({ type: 'message', id, parentId: lastIdOf(file), timestamp: new Date(at).toISOString(), message: { ...message, timestamp: at } })}\n`)
  lastIds.set(file, id)
}

const USAGE = { input: 1500, output: 220, cacheRead: 42000, cacheWrite: 0, totalTokens: 43720, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
const assistant = (content: unknown[], stopReason = 'toolUse') => ({ role: 'assistant', content, api: 'openai-completions', provider: 'lab', model: 'model', usage: USAGE, stopReason })
const thinking = () => ({ type: 'thinking', thinking: fill(between(200, 1500), sentence) })
const toolResult = (id: string, call: ToolCall) => ({ role: 'toolResult', toolCallId: id, toolName: call.name, content: [{ type: 'text', text: call.output }], ...(call.details ? { details: call.details } : {}), isError: false })

type Emit = (event: unknown) => void

/**
 * One cycle of an agent: it says a little, calls a tool and gets its output, as Pi streams and saves it. `streamed` is
 * what an assistant message already begun has said so far, which its end then holds.
 */
async function cycle(file: string, cwd: string, emit: Emit | null, { pace = 0, deltas = 8, streamed }: { pace?: number; deltas?: number; streamed?: string } = {}) {
  const id = `call_${randomBytes(6).toString('hex')}`
  const call = toolCall()
  const said = streamed ?? (random() < 0.6 ? sentence() : '')
  if (streamed === undefined) emit?.({ type: 'message_start', message: assistant([]) })
  if (emit && said && streamed === undefined) {
    for (const part of said.match(/.{1,24}/g) ?? []) {
      emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: part } })
      if (pace) await sleep(pace / deltas)
    }
  }
  const message = assistant([thinking(), ...(said ? [{ type: 'text', text: said }] : []), { type: 'toolCall', id, name: call.name, arguments: call.args }])
  save(file, message, cwd)
  emit?.({ type: 'message_end', message })
  emit?.({ type: 'tool_execution_start', toolCallId: id, toolName: call.name, args: call.args })
  if (pace) await sleep(pace)
  emit?.({ type: 'tool_execution_end', toolCallId: id, toolName: call.name, isError: false, result: { content: [{ type: 'text', text: call.output }], ...(call.details ? { details: call.details } : {}) } })
  const result = toolResult(id, call)
  save(file, result, cwd)
  emit?.({ type: 'message_start', message: result })
  emit?.({ type: 'message_end', message: result })
}

/** The user's words opening a turn, saved and streamed as Pi does. */
function userMessage(file: string, cwd: string, text: string, emit: Emit | null) {
  const message = { role: 'user', content: [{ type: 'text', text }] }
  save(file, message, cwd)
  emit?.({ type: 'message_start', message })
  emit?.({ type: 'message_end', message })
}

/** The turn's answer, streamed in pieces when it is live. */
async function answer(file: string, cwd: string, emit: Emit | null, pace = 0): Promise<string> {
  const text = markdown(between(1500, 8000))
  emit?.({ type: 'message_start', message: assistant([]) })
  if (emit) {
    for (const part of text.match(/[\s\S]{1,200}/g) ?? []) {
      emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: part } })
      if (pace) await sleep(pace)
    }
  }
  const message = assistant([thinking(), { type: 'text', text }], 'stop')
  save(file, message, cwd)
  emit?.({ type: 'message_end', message })
  return text
}

// ---------- the one seam: the application gets this lab's harness ----------
type Callbacks = { onEvent: (event: unknown) => void; onReady?: (send: (message: string) => Promise<void>) => void }
type Request = { id: string; model?: string; effort?: string; sessionFile?: string; purpose?: string; prompt?: string; cwd?: string; warm?: boolean }
interface Streaming { request: Request; callbacks: Callbacks; end: (text: string) => void }

let mode: 'seed' | 'stream' = 'seed'
const streaming: Streaming[] = []
const otherCalls: Record<string, number> = {}

const harness = async (request: Request, options: Callbacks) => {
  const result = (text: string) => ({
    id: request.id, harness: 'pi', status: 'completed', text, cost: null,
    model: request.model, effort: request.effort, sessionId: request.id, freshSession: true,
  })
  options.onReady?.(async () => {})
  if (request.warm) return result('')
  const cwd = request.cwd ?? HOME
  if (request.purpose === 'durable') {
    const file = request.sessionFile!
    const emit = mode === 'seed' ? null : options.onEvent
    userMessage(file, cwd, request.prompt ?? 'Carry on.', emit)
    const calls = mode === 'seed' ? between(5, 30) : LIVE_CALLS
    for (let index = 0; index < calls; index++) await cycle(file, cwd, emit, { pace: mode === 'seed' ? 0 : 160 })
    return result(await answer(file, cwd, emit, mode === 'seed' ? 0 : 15))
  }
  if (request.purpose === 'work-do') {
    if (mode === 'seed') return result(`Useful: ${markdown(size([[0.6, 300, 1000], [0.3, 1000, 3000], [0.08, 3000, 8000], [0.02, 8000, 32000]]))}`)
    return new Promise((resolve) => streaming.push({ request, callbacks: options, end: (text) => resolve(result(text)) }))
  }
  const purpose = request.purpose ?? 'none'
  otherCalls[purpose] = (otherCalls[purpose] ?? 0) + 1
  return result(purpose === 'short-report' ? 'A short version.' : 'Useful: done.')
}

let app: any = null
const open = HobkinApplication.open
HobkinApplication.open = async function (root, options) {
  app = await open.call(this, root, { ...options, runHarness: harness })
  return app
}

// ---------- the host's own socket, timed ----------
interface Sent { name: string; ms: number; bytes: number }
const commandsAt = new Map<string, { name: string; t0: number }>()
const commandTimes = new Map<string, Sent>()
interface WatchTime { jobs: number; ms: number; messages: number; bytes: number }
let watchTimes: WatchTime[] = []
let inWatch: WatchTime | null = null
let otherSends = { messages: 0, bytes: 0 }

const socketProto = WebSocket.prototype as unknown as { emit: (event: string, ...args: unknown[]) => boolean; send: (data: unknown, ...rest: unknown[]) => void }
const emitOf = socketProto.emit
const sendOf = socketProto.send
socketProto.emit = function (event: string, ...args: unknown[]) {
  if (event !== 'message') return emitOf.call(this, event, ...args)
  const t0 = performance.now()
  let said: { type?: string; id?: string; name?: string; jobs?: unknown[] } | null = null
  try {
    said = JSON.parse(String(args[0]))
  } catch {
    // The host closes the socket on it.
  }
  if (said?.type === 'command' && typeof said.id === 'string') commandsAt.set(said.id, { name: String(said.name), t0 })
  const watching = said?.type === 'watch' ? { jobs: Array.isArray(said.jobs) ? said.jobs.length : 0, ms: 0, messages: 0, bytes: 0 } : null
  inWatch = watching
  try {
    return emitOf.call(this, event, ...args)
  } finally {
    inWatch = null
    if (watching) {
      watching.ms = performance.now() - t0
      watchTimes.push(watching)
    }
  }
}
socketProto.send = function (data: unknown, ...rest: unknown[]) {
  const bytes = typeof data === 'string' ? Buffer.byteLength(data) : (data as Buffer).length
  if (inWatch) {
    inWatch.messages++
    inWatch.bytes += bytes
  } else if (typeof data === 'string' && data.startsWith('{"type":"result","id":"')) {
    const id = data.slice(23, data.indexOf('"', 23))
    const asked = commandsAt.get(id)
    if (asked) commandTimes.set(id, { name: asked.name, ms: performance.now() - asked.t0, bytes })
  } else {
    otherSends.messages++
    otherSends.bytes += bytes
  }
  return sendOf.call(this, data, ...rest)
}

// ---------- helpers ----------
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check: () => boolean, what: string, ms = 60_000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw Error(`Timed out waiting for ${what}`)
    await sleep(10)
  }
}
const gc = () => (globalThis as { gc?: () => void }).gc?.()
const started: Running[] = []
const noteChildren = () => {
  for (const child of descendants(process.pid)) if (!started.some(({ pid }) => pid === child.pid)) started.push(child)
}
const opened: { host: RunningHost | null } = { host: null }

async function openHost(root: string) {
  mkdirSync(BACKUPS, { recursive: true })
  writeFileSync(join(BACKUPS, 'config.json'), JSON.stringify({ enabled: false, cadence: 'daily', limit: 1 }))
  const host = opened.host = await startHost({ root, port: 0, origins: [DEV_UI_ORIGIN], backupsDir: BACKUPS, log: (line: string) => log(`host: ${line}`) })
  if (host.port === 5188) throw Error('The lab host must never take the live port.')
  await until(() => Boolean(app?.hobkins && app.snapshot), 'hobkin to open')
  // The main chat is not needed here; a scripted main that does not connect is only noted.
  await until(() => app.snapshot?.connection === 'connected', 'the main chat', 20_000).catch(() => log('the scripted main chat did not connect; going on without it'))
  return host
}

function directorStart(key: string, title: string) {
  app.director.start({
    key, lane: 'do', slug: 'lab', item: key, title, purpose: 'work-do', cwd: HOME, level: 'important',
    model: 'lab/model', effort: 'high', instructions: 'Lab only. Read the files, then say what they say.', work: () => ({}),
  })
}

const ENGINE = { kind: 'pi', model: 'lab/model', effort: 'high' }

/** Waits for a hobkin's turn in flight to end and its record to say so. */
async function turnEnds(id: string) {
  await app.hobkins.ending.get(id)
  await until(() => app.hobkins.records[id]?.state === 'waiting', `hobkin ${id} to wait`, 60_000)
  // The next turn starts at a later millisecond, so no saved message is in two turns' bounds.
  await sleep(3)
}

async function seedHobkin(turns: number, first: string): Promise<string> {
  const { id } = await app.hobkins.start({ cwd: HOME, engine: ENGINE, text: first })
  await turnEnds(id)
  for (let turn = 2; turn <= turns; turn++) {
    await app.hobkins.say(id, { text: `${sentence()} ${random() < 0.3 ? markdown(between(200, 1500)) : ''}`.trim() })
    await turnEnds(id)
    if (turn % 50 === 0) log(`hobkin ${id}: ${turn} turns`)
  }
  return id
}

// ---------- seeding ----------
async function seedHome() {
  mkdirSync(HOME, { recursive: true })
  const running = await openHost(HOME)
  const t0 = performance.now()
  mode = 'seed'
  for (let batch = 0; batch * 50 < RUNS; batch++) {
    for (let index = 0; index < Math.min(50, RUNS - batch * 50); index++) directorStart(`seed:${batch}:${index}`, `Lab seed run ${batch * 50 + index}`)
    await app.director.closing
    await app.refresh()
  }
  log(`${RUNS} runs seeded in ${Math.round(performance.now() - t0)} ms`)
  const a = await seedHobkin(TURNS, 'Lab hobkin A: work through the client host and say what you changed.')
  const b = await seedHobkin(B_TURNS, 'Lab hobkin B: a shorter conversation to switch to.')
  await app.refresh()
  noteChildren()
  log(`seeded in ${Math.round(performance.now() - t0)} ms: hobkins ${a} (${TURNS} turns), ${b} (${B_TURNS} turns)`)
  await running.close()
  return { seconds: (performance.now() - t0) / 1000, a, b }
}

// ---------- the window ----------
function startWindow(host: RunningHost) {
  const script = fileURLToPath(new URL('./open-window.ts', import.meta.url))
  const child = fork(script, [String(host.port), host.token, DEV_UI_ORIGIN, String(SECONDS * 4 + 900), HOME], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
  const ready = new Promise<{ firstState: number; takesWatch: boolean }>((resolve, reject) => {
    child.on('message', (message: { type?: string; message?: string; firstState?: number; takesWatch?: boolean }) => {
      if (message?.type === 'ready') resolve({ firstState: message.firstState!, takesWatch: message.takesWatch! })
      if (message?.type === 'error') reject(Error(message.message))
    })
  })
  const step = <T = any>(step: string, fields: Record<string, unknown> = {}) => new Promise<T>((resolve, reject) => {
    const take = (message: { type?: string; step?: string; result?: T; error?: string }) => {
      if (message?.type !== 'done' || message.step !== step) return
      child.off('message', take)
      if (message.error) reject(Error(`window ${step}: ${message.error}`))
      else resolve(message.result as T)
    }
    child.on('message', take)
    child.send({ type: 'do', step, ...fields })
  })
  const close = () => {
    try { child.send({ type: 'close' }) } catch { /* already gone */ }
    setTimeout(() => child.kill('SIGKILL'), 500).unref()
  }
  return { ready, step, close }
}

// ---------- measuring ----------
interface Asked { rid: string; name: string; job?: string; rtMs: number; bytes: number; ok: boolean; error?: string; parseMs: number; steps?: number; turns?: number }
/** The window's requests with the host's own time for each. */
const withHost = (requests: Asked[]) => requests.map((asked) => ({ ...asked, hostMs: commandTimes.get(asked.rid)?.ms ?? null }))

/** Runs `work` with the event loop's longest stall measured, and a CPU profile when asked. */
async function measuredBlock<T>(label: string, work: () => Promise<T>): Promise<T & { loopMaxMs: number; profile?: string }> {
  const delay = monitorEventLoopDelay({ resolution: 1 })
  let session: Session | null = null
  if (PROFILE) {
    session = new Session()
    session.connect()
    await session.post('Profiler.enable')
    await session.post('Profiler.setSamplingInterval', { interval: 200 })
    await session.post('Profiler.start')
  }
  delay.enable()
  const result = await work()
  delay.disable()
  let profile: string | undefined
  if (session) {
    const { profile: taken } = await session.post('Profiler.stop')
    profile = join(PROFILE, `${label}.cpuprofile`)
    writeFileSync(profile, JSON.stringify(taken))
    session.disconnect()
  }
  return { ...result, loopMaxMs: delay.max / 1e6, ...(profile ? { profile } : {}) }
}

/** The busy run's driver: words at 30 a second and a tool call every two seconds, as `lab.ts` drives its agents. */
function drive(agent: Streaming) {
  const file = agent.request.sessionFile!
  const emit: Emit = (event) => agent.callbacks.onEvent(event)
  let stopped = false
  let busy = false
  let tick = 0
  let streamed = ''
  const timer = setInterval(() => {
    if (stopped || busy) return
    tick++
    if (tick % 60 !== 0) {
      const delta = `${pick(WORDS)} `
      streamed += delta
      emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta } })
      return
    }
    busy = true
    void cycle(file, HOME, emit, { streamed }).then(() => {
      streamed = ''
      emit({ type: 'message_start', message: assistant([]) })
      busy = false
    })
  }, 1000 / 30)
  return () => {
    stopped = true
    clearInterval(timer)
  }
}

/** The host's publishes during `work`: how many, and their time in the host. */
async function publishes<T>(work: () => Promise<T>): Promise<{ result: T; count: number; ms: number[] }> {
  const ms: number[] = []
  const onChange = app.onChange
  app.onChange = (snapshot: unknown) => {
    const t = performance.now()
    onChange(snapshot)
    ms.push(performance.now() - t)
  }
  try {
    const result = await work()
    return { result, count: ms.length, ms }
  } finally {
    app.onChange = onChange
  }
}

const stats = (list: readonly number[]) => {
  const sorted = [...list].sort((a, b) => a - b)
  const at = (share: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]! : 0)
  return { n: sorted.length, median: at(0.5), p90: at(0.9), min: sorted[0] ?? 0, max: sorted.at(-1) ?? 0, sum: sorted.reduce((sum, each) => sum + each, 0) }
}

/** Times `read` `times` times in a row. */
async function timed(times: number, read: () => unknown) {
  const ms: number[] = []
  let last: unknown
  for (let index = 0; index < times; index++) {
    const t = performance.now()
    last = await read()
    ms.push(performance.now() - t)
  }
  return { ...stats(ms), last }
}

async function measured() {
  const running = await openHost(HOME)
  const hobkins = Object.values(app.hobkins.records as Record<string, { id: string; turns: number; state: string; createdAt: string }>)
    .filter((record) => record.state !== 'ended')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  const [a, b] = hobkins
  if (!a || !b) throw Error('The seeded home has no hobkins A and B.')
  const fileOf = (id: string) => join(app.runtime.directory, 'hobkins', `${id}.jsonl`)
  const sizes = {
    runtimeDocumentBytes: JSON.stringify(await app.runtime.document()).length,
    runs: Object.keys((await app.runtime.document()).runs ?? {}).length,
    aTurns: a.turns,
    bTurns: b.turns,
    aSessionBytes: statSync(fileOf(a.id)).size,
    bSessionBytes: statSync(fileOf(b.id)).size,
  }
  log(`opened: ${JSON.stringify(sizes)}`)

  // The busy work run, with its first --work-calls tool calls made.
  mode = 'stream'
  directorStart('busy', 'Busy lab agent')
  await until(() => streaming.length >= 1, 'the busy run to start')
  const busy = streaming[0]!
  const busyFile = busy.request.sessionFile!
  const busyEmit: Emit = (event) => busy.callbacks.onEvent(event)
  const t = performance.now()
  userMessage(busyFile, HOME, 'Lab only: a long work run.', busyEmit)
  for (let index = 0; index < WORK_CALLS; index++) {
    await cycle(busyFile, HOME, busyEmit)
    if (index % 25 === 0) await new Promise((resolve) => setImmediate(resolve))
  }
  busyEmit({ type: 'message_start', message: assistant([]) })
  await sleep(2000)
  await app.refresh()
  const busyRun = (app.snapshot.runs as { id: string; state: string; title: string }[]).find((run) => run.title === 'Busy lab agent' && run.state === 'running')?.id
  if (!busyRun) throw Error('The busy run is not in the snapshot.')
  Object.assign(sizes, { busyCalls: WORK_CALLS, busySessionBytes: statSync(busyFile).size, busyFeedSteps: app.snapshot.jobActivity?.[busyRun]?.length })
  log(`busy run ${busyRun}: ${WORK_CALLS} calls in ${Math.round(performance.now() - t)} ms, session ${statSync(busyFile).size} bytes`)
  gc()
  await sleep(500)

  const window = startWindow(running)
  const { firstState, takesWatch } = await window.ready
  if (!takesWatch) throw Error('The host does not take watching.')
  await sleep(500)
  commandTimes.clear()
  watchTimes = []

  const openPage = async (label: string, id: string) => {
    const watchedBefore = watchTimes.length
    const result = await measuredBlock(label, () => window.step('open-hobkin', { id }))
    const watches = watchTimes.slice(watchedBefore)
    await window.step('leave')
    await sleep(300)
    return { label, ...result, requests: withHost(result.requests), hostWatch: { messages: watches.length, ms: stats(watches.map(({ ms }) => ms)), bytesSent: watches.reduce((sum, { bytes }) => sum + bytes, 0) } }
  }
  const pages = []
  pages.push(await openPage('a-cold', a.id))
  pages.push(await openPage('a-again', a.id))
  pages.push(await openPage('b-cold', b.id))
  pages.push(await openPage('a-after-b', a.id))

  // The busy run's page: watched, its notes and schedules; then two pages of its older steps.
  const watchedBefore = watchTimes.length
  const runOpen = await window.step('open-run', { run: busyRun })
  const runWatch = watchTimes.slice(watchedBefore)
  const older1 = await window.step('load-older')
  const older2 = await window.step('load-older')
  const runPage = {
    ...runOpen,
    requests: withHost(runOpen.requests),
    hostWatch: runWatch,
    older: [older1, older2].map(({ request, held }: { request: Asked; held: number }) => ({ ...withHost([request])[0], held })),
  }

  // The busy run streaming while its page shows with older pages held, then with no page on it.
  const stream = async (label: string, following: boolean) => {
    if (following) await window.step('follow')
    await window.step('count')
    otherSends = { messages: 0, bytes: 0 }
    const stop = drive(busy)
    const { result, count, ms } = await publishes(() => measuredBlock(label, async () => {
      await sleep(SECONDS * 1000)
      return {}
    }))
    stop()
    await sleep(300)
    const counted = await window.step('count')
    const follows = following ? withHost((await window.step('unfollow')).requests) : []
    return { label, seconds: SECONDS, loopMaxMs: result.loopMaxMs, publishes: { count, ms: stats(ms) }, sent: { ...otherSends }, received: counted, follows }
  }
  const watchedStream = await stream('busy-watched', true)
  await window.step('leave-run')
  await sleep(300)
  const tailStream = await stream('busy-tail', false)

  // A working turn on hobkin A's open page.
  await window.step('open-hobkin', { id: a.id })
  const turn = await publishes(() => window.step('working-turn', { id: a.id, text: 'Lab: one more long turn with many tool calls.' }))
  await window.step('leave')
  const workingTurn = { ...turn.result, requests: withHost(turn.result.requests), publishes: { count: turn.count, ms: stats(turn.ms) } }

  // The readers one at a time in this process, through the host's own handlers, with the window idle.
  busy.end('Useful: the busy lab agent finished.')
  await Promise.race([Promise.resolve(app.director.closing).catch(() => {}), sleep(30_000)])
  await app.refresh()
  await sleep(500)
  gc()
  const runtime = app.runtime
  const state = await timed(10, () => runtime.state())
  const parsed = state.last
  const read = await timed(10, () => app.hobkins.read(a.id))
  const readJson = await timed(10, () => JSON.stringify(read.last))
  const handlers = olderStepsHandlers({ data: () => runtime.directory, state: () => runtime.state() })
  const parsedOnce = olderStepsHandlers({ data: () => runtime.directory, state: async () => parsed as any })
  const turnsOf = (id: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => `hobkin:${id}:${from + index}`)
  const each = async (seat: typeof handlers, jobs: string[]) => {
    const ms: number[] = []
    const bytes: number[] = []
    for (const job of jobs) {
      const t0 = performance.now()
      const page = await seat['activity.before']!({ job })
      ms.push(performance.now() - t0)
      bytes.push(JSON.stringify(page).length)
    }
    return { ms: stats(ms), bytes: stats(bytes) }
  }
  // Turns no page open read: A's oldest, in two blocks of up to 20.
  const block = Math.min(20, Math.floor(a.turns / 2))
  const coldWithState = await each(handlers, turnsOf(a.id, 1, block))
  const warmWithState = await each(handlers, turnsOf(a.id, 1, block))
  const coldStepsOnly = await each(parsedOnce, turnsOf(a.id, block + 1, 2 * block))
  const warmStepsOnly = await each(parsedOnce, turnsOf(a.id, block + 1, 2 * block))
  const busyOlder = await timed(3, async () => {
    // A new version of the busy run's session each time, as while it streams: one more saved line.
    save(busyFile, { role: 'custom', customType: 'lab', content: 'mark', display: false }, HOME)
    return handlers['activity.before']!({ job: busyRun })
  })
  const direct = {
    stateMs: { ...state, last: undefined },
    stateBytes: JSON.stringify(parsed).length,
    hobkinReadMs: { ...read, last: undefined },
    hobkinReadBytes: JSON.stringify(read.last).length,
    hobkinReadStringifyMs: { ...readJson, last: undefined },
    turnStepsCold: coldWithState,
    turnStepsWarm: warmWithState,
    turnStepsColdWithoutState: coldStepsOnly,
    turnStepsWarmWithoutState: warmStepsOnly,
    busyOlderAfterWriteMs: { ...busyOlder, last: undefined },
  }

  noteChildren()
  window.close()
  await running.close()
  return { runtimePath, sizes, firstState, pages, runPage, watchedStream, tailStream, workingTurn, direct, otherCalls }
}

try {
  const result = SEED ? await seedHome() : await measured()
  console.log(JSON.stringify({ result, started }))
} catch (error) {
  log(`failed: ${error instanceof Error ? error.stack : String(error)}`)
  console.log(JSON.stringify({ error: String(error), started }))
  process.exitCode = 1
  // A run still streaming would hold the close open.
  for (const agent of streaming) agent.end('Useful: stopped by the lab.')
  try { await Promise.race([opened.host?.close(), sleep(15_000)]) } catch { /* closing is best effort here */ }
} finally {
  setTimeout(() => process.exit(process.exitCode ?? 0), 300).unref()
}
