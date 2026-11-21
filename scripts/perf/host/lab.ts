/**
 * The host load lab, run by `scripts/perf/host-load.ts` in a process of its own. It starts the real host (`startHost`,
 * port 0, the scripted main model, backups off) on a home under the system temp folder, and for a measured run feeds
 * synthetic Pi events into N real work agents while a fake window (`window.ts`, another process) counts what it gets.
 *
 * The one seam: `HobkinApplication.open` is wrapped so the application gets this lab's job runner, which a live host
 * gets from Pi. Each agent event enters where the real harness hands it on (`options.onEvent(record)` in hobkin's
 * `src/cli/harnesses.mjs`), so the runner, JobActivity, the 25 ms batch, `publishActivity`, the host's `publish()`,
 * `StateSync.update` and the socket send are all the real code.
 *
 * Usage: node lab.ts --seed --home <dir> --backups <dir>
 *        node lab.ts --home <dir> --backups <dir> [--agents N] [--seconds S] [--history K] [--rate R] [--cycle S]
 *                    [--no-session] [--no-client] [--profile <file.cpuprofile>]
 * It prints one line of JSON on stdout: the result, and the processes it started.
 */
import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { fork } from 'node:child_process'
import { Session } from 'node:inspector/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { HobkinApplication } from 'hobkin/src/cli/application.mjs'
import { initialize, setTelemetryUpload } from 'hobkin/src/cli/config.mjs'
import { DEV_UI_ORIGIN } from '../../../host/src/access.ts'
import { startHost, type RunningHost } from '../../../host/src/host.ts'
import { descendants, type Running } from './processes.ts'

const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(name)
const value = (name: string, fallback: string) => {
  const at = argv.indexOf(name)
  return at === -1 ? fallback : argv[at + 1]!
}
const SEED = flag('--seed')
const HOME = value('--home', '')
const BACKUPS = value('--backups', '')
const AGENTS = Number(value('--agents', '1'))
const SECONDS = Number(value('--seconds', '60'))
const HISTORY = Number(value('--history', '0'))
const DELTAS_PER_SECOND = Number(value('--rate', '30'))
const CYCLE_SECONDS = Number(value('--cycle', '2'))
const PROFILE = value('--profile', '')
const NO_CLIENT = flag('--no-client')
// Pi writes each finished message to the run's session file, with its usage, and hobkin's director meters tokens from
// it every tick. The lab does the same at each message end, unless --no-session.
const SESSION = !flag('--no-session')

const log = (line: string) => process.stderr.write(`[host-load ${SEED ? 'seed' : 'run'}] ${line}\n`)

// Safety: the home and its backups are under the system temp folder, never a real home.
const temporary = realpathSync(tmpdir())
const inside = (path: string) => Boolean(path) && realpathSync(dirname(path)).startsWith(temporary + sep)
if (!inside(HOME) || !inside(BACKUPS) || HOME.startsWith(join(homedir(), '.hobkin'))) throw Error(`Refusing a home outside ${temporary}: ${HOME}`)
if (!process.env.PI_CODING_AGENT_DIR || !inside(process.env.PI_CODING_AGENT_DIR)) throw Error('PI_CODING_AGENT_DIR must be a folder under the system temp folder.')

// ---------- the one seam: the application gets this lab's job runner ----------
type Callbacks = { onEvent: (event: unknown) => void; onReady?: (send: (message: string) => Promise<void>) => void }
type Ended = { status: string; text: string }
type Request = { id: string; model?: string; effort?: string; sessionFile?: string; purpose?: string }
interface Streaming { id: string; request: Request; callbacks: Callbacks; end: (outcome: Ended) => void }

let mode: 'seed' | 'stream' = 'seed'
let nextText: () => string = () => 'Useful: done.'
const streaming: Streaming[] = []
const otherCalls: Record<string, number> = {}

const harness = async (request: Request, options: Callbacks) => {
  const result = (outcome: Ended) => ({
    id: request.id, harness: 'pi', status: outcome.status, text: outcome.text, cost: null,
    model: request.model, effort: request.effort, sessionId: request.id, freshSession: true,
  })
  options.onReady?.(async () => {})
  // Only the lab's own agents stream. hobkin's other model calls (short reports, report edits) answer at once.
  if (request.purpose !== 'work-do') {
    const purpose = request.purpose ?? 'none'
    otherCalls[purpose] = (otherCalls[purpose] ?? 0) + 1
    return result({ status: 'completed', text: purpose === 'short-report' ? 'A short version.' : 'Useful: done.' })
  }
  if (mode === 'seed') return result({ status: 'completed', text: nextText() })
  return new Promise((resolve) => {
    streaming.push({ id: request.id, request, callbacks: options, end: (outcome) => resolve(result(outcome)) })
  })
}

// The application as the lab drives it: its director, runner and refresh path, which its types do not list.
let app: any = null
const opener = HobkinApplication as unknown as { open: (root: string, options: Record<string, unknown>) => Promise<unknown> }
const open = opener.open
opener.open = async function (root, options) {
  app = await open.call(this, root, { ...options, runHarness: harness })
  return app
}

// ---------- synthetic content, sized like the real home ----------
// mulberry32: a repeatable stream of numbers in [0, 1).
let seed = 42
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const WORDS = 'the host reads each report and sends only what changed so the window draws less while agents work through the queue of items in every project'.split(' ')
const prose = (bytes: number) => {
  const out: string[] = []
  let size = 0
  while (size < bytes) {
    const line = Array.from({ length: 12 }, () => WORDS[Math.floor(random() * WORDS.length)]).join(' ')
    out.push(random() < 0.1 ? `\n## ${line.slice(0, 30)}\n` : `- ${line}.`)
    size += line.length + 3
  }
  return out.join('\n').slice(0, bytes)
}
// Like the real home's 712 reports and 1.6 MB saved view: most reports are short and a few are long (about 1.8 KB on average).
const reportSize = () => {
  const r = random()
  if (r < 0.6) return 300 + Math.floor(random() * 700)
  if (r < 0.9) return 1000 + Math.floor(random() * 2000)
  if (r < 0.98) return 3000 + Math.floor(random() * 5000)
  return 8000 + Math.floor(random() * 24000)
}

function writeRoutines(root: string) {
  const folder = join(root, 'routines', 'daily')
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  for (let index = 0; index < 50; index++) {
    const id = `lab-routine-${String(index).padStart(2, '0')}`
    const meta = { id, title: `Lab routine ${index}`, at: '04:00', timezone: 'America/Toronto', enabled: true, harness: 'pi', effort: 'medium', cwd: root, context: [] }
    writeFileSync(join(folder, `${id}.md`), `---\n${JSON.stringify(meta, null, 2)}\n---\n${prose(800)}\n`, { mode: 0o600 })
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check: () => boolean, what: string, ms = 60_000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw Error(`Timed out waiting for ${what}`)
    await sleep(20)
  }
}

interface Counts { type: 'counts'; messages: number; bytes: number; states: number; largest: number; p50: number; p99: number }

function startWindow(host: RunningHost) {
  const script = fileURLToPath(new URL('./window.ts', import.meta.url))
  const child = fork(script, [String(host.port), host.token, DEV_UI_ORIGIN, String(SECONDS + HISTORY / 5 + 300), HOME], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
  const opened = new Promise<void>((resolve, reject) => {
    child.on('message', (message: { type?: string; message?: string }) => {
      if (message?.type === 'open') resolve()
      if (message?.type === 'error') reject(Error(message.message))
    })
  })
  const read = (reset = false) => new Promise<Counts>((resolve) => {
    const take = (message: Counts) => {
      if (message?.type !== 'counts') return
      child.off('message', take)
      resolve(message)
    }
    child.on('message', take)
    child.send({ type: 'read', reset })
  })
  const close = () => {
    try { child.send({ type: 'close' }) } catch { /* already gone */ }
    setTimeout(() => child.kill('SIGKILL'), 500).unref()
  }
  return { opened, read, close }
}

function directorStart(key: string, title: string, home: string) {
  app.director.start({
    key, lane: 'do', slug: 'lab', item: key, title, purpose: 'work-do', cwd: home, level: 'important',
    model: 'lab/model', effort: 'high', instructions: 'Lab only.', work: () => ({}),
  })
}

/** Every process this one started, as they run now. The orchestrator checks that none outlives the run. */
const started: Running[] = []
const noteChildren = () => {
  for (const child of descendants(process.pid)) if (!started.some(({ pid }) => pid === child.pid)) started.push(child)
}

/** The host that is open, so a failure still closes it. */
const opened: { host: RunningHost | null } = { host: null }

async function openHost(root: string) {
  mkdirSync(BACKUPS, { recursive: true })
  // No automatic backup during the lab.
  writeFileSync(join(BACKUPS, 'config.json'), JSON.stringify({ enabled: false, cadence: 'daily', limit: 1 }))
  const host = opened.host = await startHost({ root, port: 0, origins: [DEV_UI_ORIGIN], backupsDir: BACKUPS, log: (line: string) => log(`host: ${line}`) })
  if (host.port === 5188) throw Error('The lab host must never take the live port.')
  await until(() => Boolean(app?.runtime?.main) && app.snapshot?.connection === 'connected', 'hobkin to open')
  return host
}

// ---------- seeding the home ----------
async function seedHome() {
  const root = HOME
  mkdirSync(root, { recursive: true })
  initialize(root, { cwd: root })
  setTelemetryUpload(root, false)
  writeRoutines(root)
  const running = await openHost(root)
  const t0 = performance.now()
  // 50 chat turns: 100 kept messages.
  for (let turn = 0; turn < 50; turn++) {
    await app.send(turn % 5 === 0 ? 'markdown' : `Lab message ${turn}: ${prose(60 + Math.floor(random() * 400))}`)
    await sleep(50)
    await until(() => !app.runtime.mainBusy, 'the turn to end', 20_000)
    await sleep(5)
  }
  noteChildren()
  log(`chat seeded in ${Math.round(performance.now() - t0)} ms`)
  // 700 finished runs with reports, in batches.
  mode = 'seed'
  nextText = () => `Useful: ${prose(reportSize())}`
  for (let batch = 0; batch < 14; batch++) {
    for (let index = 0; index < 50; index++) directorStart(`seed:${batch}:${index}`, `Lab seed run ${batch * 50 + index}`, root)
    await app.director.closing
    await app.refresh()
  }
  await app.refresh()
  noteChildren()
  const snapshot = app.snapshot
  log(`seeded in ${Math.round(performance.now() - t0)} ms: ${snapshot.reports?.length} reports, ${snapshot.messages?.length} messages, ${snapshot.schedules?.length} routines`)
  await running.close()
  return { seconds: (performance.now() - t0) / 1000 }
}

// ---------- the measured run ----------
interface Sample { t: number; cpuUser: number; cpuSystem: number; rss: number; heapUsed: number }
const sample = (t0: number): Sample => {
  const cpu = process.cpuUsage()
  const memory = process.memoryUsage()
  return { t: (performance.now() - t0) / 1000, cpuUser: cpu.user / 1e6, cpuSystem: cpu.system / 1e6, rss: memory.rss, heapUsed: memory.heapUsed }
}
const gc = () => (globalThis as { gc?: () => void }).gc?.()

async function measured() {
  const root = HOME
  const running = await openHost(root)
  const window = NO_CLIENT ? null : startWindow(running)
  await window?.opened

  // Counters around the real methods (instance wrappers; nothing in either repository changes).
  const counts = {
    events: 0,
    // Host publishes, all of them and those after an activity-only refresh or any other.
    onChange: 0,
    hostPublishMs: 0,
    activityHostPublishMs: 0,
    otherPublishes: 0,
    otherHostPublishMs: 0,
    // The runtime's own side: its activity publishes, its full refreshes and its scheduler ticks.
    publishActivity: 0,
    publishActivityMs: 0,
    project: 0,
    projectWallMs: 0,
    ticks: 0,
    tickWallMs: 0,
  }
  let maxHostPublishMs = 0
  let inActivity = false
  const onChange = app.onChange
  app.onChange = (snapshot: unknown) => {
    counts.onChange++
    const t = performance.now()
    onChange(snapshot)
    const took = performance.now() - t
    counts.hostPublishMs += took
    maxHostPublishMs = Math.max(maxHostPublishMs, took)
    if (inActivity) counts.activityHostPublishMs += took
    else {
      counts.otherPublishes++
      counts.otherHostPublishMs += took
    }
  }
  const publishActivity = app.publishActivity.bind(app)
  app.publishActivity = () => {
    counts.publishActivity++
    const t = performance.now()
    const before = counts.hostPublishMs
    inActivity = true
    try { publishActivity() } finally { inActivity = false }
    counts.publishActivityMs += performance.now() - t - (counts.hostPublishMs - before)
  }
  const project = app.project.bind(app)
  app.project = async (...args: unknown[]) => {
    counts.project++
    const t = performance.now()
    try { return await project(...args) } finally { counts.projectWallMs += performance.now() - t }
  }
  const performTick = app.runner.performTick.bind(app.runner)
  app.runner.performTick = async () => {
    counts.ticks++
    const t = performance.now()
    try { return await performTick() } finally { counts.tickWallMs += performance.now() - t }
  }

  // Start N agents and wait until every one is streaming.
  mode = 'stream'
  const startT = performance.now()
  const startCpu = process.cpuUsage()
  for (let index = 0; index < AGENTS; index++) directorStart(`agent:${index}`, `Lab agent ${index}`, root)
  if (AGENTS) await until(() => streaming.length >= AGENTS, `${AGENTS} agents to start`, 60_000)
  const startCpuUsed = process.cpuUsage(startCpu)
  const startup = { ms: Math.round(performance.now() - startT), cpuSeconds: (startCpuUsed.user + startCpuUsed.system) / 1e6 }
  await sleep(1500)
  log(`${streaming.length} agents streaming; startup ${JSON.stringify(startup)}`)
  // Let the start burst's garbage go before the window opens.
  gc()
  await sleep(500)

  // Each agent: a message of text deltas at DELTAS_PER_SECOND, then a tool call, every CYCLE_SECONDS. Phases are staggered.
  const period = 1000 / DELTAS_PER_SECOND
  const perCycle = Math.round(CYCLE_SECONDS * DELTAS_PER_SECOND)
  const phase = streaming.map((_, index) => Math.floor((index * perCycle) / Math.max(1, streaming.length)))
  let tick = 0
  let call = 0
  const emit = (agent: Streaming, event: unknown) => {
    counts.events++
    agent.callbacks.onEvent(event)
  }
  const step = () => {
    tick++
    streaming.forEach((agent, index) => {
      const at = (tick + phase[index]!) % perCycle
      if (at !== 0) {
        emit(agent, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: `${WORDS[(tick + index) % WORDS.length]} ` } })
        return
      }
      const id = `call-${agent.id}-${call++}`
      const message = { role: 'assistant', content: [{ type: 'text', text: 'done' }, { type: 'toolCall', id, name: 'read', arguments: { path: `src/file-${call}.ts` } }], usage: { input: 1500, output: 120, cacheRead: 24000, cacheWrite: 0 }, stopReason: 'toolUse' }
      emit(agent, { type: 'message_end', message })
      const output = prose(1500)
      if (SESSION && agent.request.sessionFile) {
        appendFileSync(agent.request.sessionFile, `${JSON.stringify({ type: 'message', id, timestamp: new Date().toISOString(), message })}\n${JSON.stringify({ type: 'message', id: `${id}-r`, message: { role: 'toolResult', toolCallId: id, toolName: 'read', content: [{ type: 'text', text: output }] } })}\n`)
      }
      emit(agent, { type: 'tool_execution_start', toolCallId: id, toolName: 'read', args: { path: `src/file-${call}.ts` } })
      emit(agent, { type: 'tool_execution_end', toolCallId: id, toolName: 'read', isError: false, result: { content: [{ type: 'text', text: output }] } })
      emit(agent, { type: 'message_start', message: { role: 'assistant', content: [] } })
    })
  }
  for (const agent of streaming) agent.callbacks.onEvent({ type: 'message_start', message: { role: 'assistant', content: [] } })
  // --history K: each agent has already worked K cycles (a 20-word message and a tool call each), as an agent that
  // has run for a while has. The feed keeps every one of them for the life of the run.
  if (HISTORY) {
    const t = performance.now()
    for (const agent of streaming) {
      for (let cycle = 0; cycle < HISTORY; cycle++) {
        for (let word = 0; word < 20; word++) agent.callbacks.onEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: `${WORDS[(cycle + word) % WORDS.length]} ` } })
        const id = `past-${agent.id}-${cycle}`
        agent.callbacks.onEvent({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'past' }, { type: 'toolCall', id, name: 'read', arguments: { path: `src/past-${cycle}.ts` } }] } })
        agent.callbacks.onEvent({ type: 'tool_execution_start', toolCallId: id, toolName: 'read', args: { path: `src/past-${cycle}.ts` } })
        agent.callbacks.onEvent({ type: 'tool_execution_end', toolCallId: id, toolName: 'read', isError: false, result: { content: [{ type: 'text', text: prose(1500) }] } })
        agent.callbacks.onEvent({ type: 'message_start', message: { role: 'assistant', content: [] } })
      }
      await new Promise((resolve) => setImmediate(resolve))
    }
    await sleep(2000)
    gc()
    await sleep(500)
    log(`history of ${HISTORY} cycles per agent in ${Math.round(performance.now() - t)} ms; heap ${Math.round(process.memoryUsage().heapUsed / 2 ** 20)} MB`)
  }

  const delay = monitorEventLoopDelay({ resolution: 10 })
  const elu0 = performance.eventLoopUtilization()
  const t0 = performance.now()
  const samples: Sample[] = [sample(t0)]
  await window?.read(true)
  let session: Session | null = null
  if (PROFILE) {
    session = new Session()
    session.connect()
    await session.post('Profiler.enable')
    await session.post('Profiler.setSamplingInterval', { interval: 1000 })
    await session.post('Profiler.start')
  }
  delay.enable()
  const startCounts = { ...counts }
  // Drift-free driver: emits as many steps as are due.
  let due = 0
  const driver = setInterval(() => {
    const should = Math.floor((performance.now() - t0) / period)
    while (due < should) {
      due++
      step()
    }
  }, Math.max(1, Math.floor(period)))
  const sampler = setInterval(() => samples.push(sample(t0)), 5000)
  await sleep(SECONDS * 1000)
  clearInterval(driver)
  clearInterval(sampler)
  delay.disable()
  samples.push(sample(t0))
  const elu = performance.eventLoopUtilization(elu0)
  const wall = (performance.now() - t0) / 1000
  if (session) {
    const { profile } = await session.post('Profiler.stop')
    writeFileSync(PROFILE, JSON.stringify(profile))
    session.disconnect()
  }
  const socket = window ? await window.read() : null
  noteChildren()
  const first = samples[0]!, last = samples.at(-1)!
  const delta = Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, count - startCounts[key as keyof typeof counts]])) as typeof counts
  const snapshot = app.snapshot
  const result = {
    agents: AGENTS, history: HISTORY, seconds: wall, rate: DELTAS_PER_SECOND, cycleSeconds: CYCLE_SECONDS, window: !NO_CLIENT, session: SESSION, profile: PROFILE || null, startup,
    cpuPerWall: (last.cpuUser + last.cpuSystem - first.cpuUser - first.cpuSystem) / wall,
    cpuUserPerWall: (last.cpuUser - first.cpuUser) / wall,
    eventLoopUtilization: elu.utilization,
    loopDelayMs: { p99: delay.percentile(99) / 1e6, max: delay.max / 1e6 },
    eventsPerSecond: delta.events / wall,
    publishesPerSecond: delta.onChange / wall,
    activityPublishesPerSecond: delta.publishActivity / wall,
    otherPublishesPerSecond: delta.otherPublishes / wall,
    hostPublishMs: delta.onChange ? delta.hostPublishMs / delta.onChange : 0,
    activityPublishMs: delta.publishActivity ? delta.activityHostPublishMs / delta.publishActivity : 0,
    otherPublishMs: delta.otherPublishes ? delta.otherHostPublishMs / delta.otherPublishes : 0,
    maxPublishMs: maxHostPublishMs,
    runtimePublishActivityMs: delta.publishActivity ? delta.publishActivityMs / delta.publishActivity : 0,
    refreshesPerSecond: delta.project / wall,
    refreshWallMs: delta.project ? delta.projectWallMs / delta.project : 0,
    tickWallMs: delta.ticks ? delta.tickWallMs / delta.ticks : 0,
    socket: socket && { messagesPerSecond: socket.messages / wall, bytesPerSecond: socket.bytes / wall, statesPerSecond: socket.states / wall, largest: socket.largest, p50: socket.p50, p99: socket.p99 },
    memory: { rssStartMB: first.rss / 2 ** 20, rssEndMB: last.rss / 2 ** 20, heapStartMB: first.heapUsed / 2 ** 20, heapEndMB: last.heapUsed / 2 ** 20 },
    sizes: {
      reports: snapshot.reports?.length, messages: snapshot.messages?.length, routines: snapshot.schedules?.length,
      activityEntries: Object.values(snapshot.jobActivity ?? {}).reduce((sum: number, list) => sum + (list as unknown[]).length, 0),
      wireSnapshotBytes: JSON.stringify(snapshot).length,
    },
  }

  // Wind down: end every agent, close the window and the host.
  for (const agent of streaming) agent.end({ status: 'completed', text: 'Useful: lab agent finished.' })
  await Promise.race([Promise.resolve(app.director.closing).catch(() => {}), sleep(30_000).then(() => log('the director did not settle in 30 s'))])
  await Promise.race([app.refresh(), sleep(10_000)])
  log(`other model calls ${JSON.stringify(otherCalls)}`)
  window?.close()
  await running.close()
  return result
}

try {
  const result = SEED ? await seedHome() : await measured()
  console.log(JSON.stringify({ result, started }))
} catch (error) {
  log(`failed: ${error instanceof Error ? error.stack : String(error)}`)
  console.log(JSON.stringify({ error: String(error), started }))
  process.exitCode = 1
  try { await opened.host?.close() } catch { /* closing is best effort here */ }
} finally {
  setTimeout(() => process.exit(process.exitCode ?? 0), 300).unref()
}
