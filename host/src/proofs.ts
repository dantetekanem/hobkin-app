import { existsSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { ProofOutcome, ProofRun, ProofRunSummary, ProofsState, ProofStep, ProofStepId, ProofTools } from '#shared/protocol/proofs.ts'
import { Unavailable, type HostHandlers } from './commands.ts'

/**
 * TLA+ proof runs for the window (_specs/050-tla-proofs). hobkin's `hobkin proof check` writes each run under
 * `<home>/proofs/<id>/`: `events.jsonl` and a `pid` while it runs, `result.json` when it ends. The host only reads those
 * files, keeps the `proofs` slice, and passes stop, again and setup to the runtime's own functions.
 */

/** Runs the slice keeps besides the ones still running. */
const RECENT_RUNS = 20
/** A run is read again at most this often, so a busy TLC reaches the window at most twice a second. */
const MIN_GAP_MS = 500
/** How often the folder is looked at when the watcher says nothing. */
const POLL_MS = 1000
/** How long a stopped process has to end before it is killed. */
const STOP_GRACE_MS = 2000
/** A run with no pid file is taken as still running while its events are this fresh. */
const FRESH_EVENTS_MS = 30000

const STEPS: ProofStepId[] = ['parse', 'check', 'prove']
const FINAL: ProofOutcome[] = ['holds', 'broken', 'error', 'stopped']

type Json = Record<string, unknown>

const asObject = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {})
const asNumber = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

const readJson = (path: string): Json | null => {
  const text = readText(path)
  if (text === null) return null
  try {
    return asObject(JSON.parse(text))
  } catch {
    return null
  }
}

/** The events a run wrote, in order. A line cut off by a write in progress is left out. */
function readEvents(path: string): Json[] {
  const text = readText(path)
  if (!text) return []
  return text.split('\n').flatMap((line) => {
    if (!line.trim()) return []
    try {
      return [asObject(JSON.parse(line))]
    } catch {
      return []
    }
  })
}

const emptySteps = (): ProofStep[] => STEPS.map((id) => ({ id, state: 'waiting', note: '' }))

/** A run as its events say so far. Every field an event does not carry keeps its empty value. */
export function foldEvents(id: string, events: Json[]): ProofRun {
  const run: ProofRun = {
    id,
    spec: '',
    tool: 'TLC',
    workers: 0,
    started: '',
    outcome: 'checking',
    steps: emptySteps(),
    stats: { generated: 0, distinct: 0, queue: 0, depth: 0 },
    rules: [],
    actions: [],
    samples: [],
    definitions: [],
    log: [],
  }
  let startedAt = NaN
  for (const event of events) {
    const at = typeof event.at === 'string' ? event.at : undefined
    switch (event.type) {
      case 'start': {
        for (const key of ['project', 'item', 'spec', 'head', 'tool', 'model'] as const) if (typeof event[key] === 'string') run[key] = event[key]
        if (typeof event.workers === 'number') run.workers = event.workers
        if (at) run.started = at
        startedAt = Date.parse(run.started)
        break
      }
      case 'step': {
        const step = run.steps.find((candidate) => candidate.id === event.step)
        if (step) {
          if (typeof event.state === 'string') step.state = event.state as ProofStep['state']
          if (typeof event.note === 'string') step.note = event.note
        }
        break
      }
      case 'progress':
      case 'stats': {
        run.stats = {
          generated: asNumber(event.generated, run.stats.generated),
          distinct: asNumber(event.distinct, run.stats.distinct),
          queue: asNumber(event.queue, run.stats.queue),
          depth: asNumber(event.depth, run.stats.depth),
        }
        const when = at ? Date.parse(at) : NaN
        const ms = typeof event.ms === 'number' ? event.ms : Number.isNaN(when) || Number.isNaN(startedAt) ? NaN : when - startedAt
        if (!Number.isNaN(ms)) run.samples.push({ at: ms, distinct: run.stats.distinct })
        break
      }
      case 'rule': {
        if (typeof event.name !== 'string') break
        const rule = { name: event.name, kind: event.kind, status: event.status, ...(typeof event.words === 'string' ? { words: event.words } : {}) } as ProofRun['rules'][number]
        const at = run.rules.findIndex((held) => held.name === rule.name)
        if (at === -1) run.rules.push(rule)
        else run.rules[at] = { ...run.rules[at], ...rule }
        break
      }
      case 'action': {
        if (typeof event.name !== 'string') break
        const action = { name: event.name, count: asNumber(event.count), ...(typeof event.code === 'string' ? { code: event.code } : {}) }
        const held = run.actions.findIndex((candidate) => candidate.name === action.name)
        if (held === -1) run.actions.push(action)
        else run.actions[held] = { ...run.actions[held], ...action }
        break
      }
      case 'definitions':
        if (Array.isArray(event.definitions)) run.definitions = event.definitions as ProofRun['definitions']
        break
      case 'trace':
        if (Array.isArray(event.states)) {
          run.trace = event.states as ProofRun['trace']
          run.traceLength = event.states.length
        }
        break
      case 'graph':
        if (event.graph) run.graph = event.graph as ProofRun['graph']
        break
      case 'proof':
        if (Array.isArray(event.obligations)) run.proof = { strict: event.strict === true, obligations: event.obligations as never }
        break
      case 'log':
        if (typeof event.text === 'string') run.log.push({ at: at ?? '', text: event.text, tone: (event.tone as never) ?? 'running', ...(typeof event.detail === 'string' ? { detail: event.detail } : {}) })
        break
      case 'end': {
        if (FINAL.includes(event.outcome as ProofOutcome)) run.outcome = event.outcome as ProofOutcome
        if (typeof event.message === 'string') run.message = event.message
        if (typeof event.broken === 'string') run.broken = event.broken
        if (at) run.finished = at
        break
      }
    }
  }
  return run
}

/** What the slice carries of a whole run, with how fast new states come in while it checks. */
export function summaryOf(run: ProofRun): ProofRunSummary {
  const { samples, trace: _trace, graph: _graph, definitions: _definitions, proof: _proof, log: _log, ...summary } = run
  const [before, after] = samples.slice(-2)
  const seconds = before && after ? (after.at - before.at) / 1000 : 0
  const rate = run.outcome === 'checking' && seconds > 0 ? Math.max(0, Math.round((after!.distinct - before!.distinct) / seconds)) : undefined
  return { ...summary, ...(rate === undefined ? {} : { rate }) }
}

export const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // Not allowed to signal it means it exists.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const readPid = (folder: string): number | null => {
  const pid = Number.parseInt(readText(join(folder, 'pid'))?.trim() ?? '', 10)
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

export interface ReadOptions {
  alive?: (pid: number) => boolean
  now?: () => number
  /** Runs the host ended itself, by id: when the runtime could not record `stopped`, the window still shows it. */
  stopped?: ReadonlySet<string>
}

/** One run from its folder: `result.json` over what the events say, or the events alone while it runs. Null when the folder holds neither. */
export function readRun(folder: string, id: string, { alive = pidAlive, now = Date.now, stopped }: ReadOptions = {}): ProofRun | null {
  const result = readJson(join(folder, 'result.json'))
  const eventsPath = join(folder, 'events.jsonl')
  const events = existsSync(eventsPath) ? readEvents(eventsPath) : []
  if (!result && !events.length) return null

  const folded = foldEvents(id, events)
  if (result) {
    const run = { ...folded, ...result, id, steps: Array.isArray(result.steps) ? (result.steps as ProofStep[]) : folded.steps } as ProofRun
    run.samples = Array.isArray(result.samples) ? (result.samples as ProofRun['samples']) : folded.samples
    run.definitions = Array.isArray(result.definitions) ? (result.definitions as ProofRun['definitions']) : folded.definitions
    run.log = Array.isArray(result.log) ? (result.log as ProofRun['log']) : folded.log
    if (!FINAL.includes(run.outcome)) run.outcome = 'error'
    return run
  }

  if (FINAL.includes(folded.outcome)) return folded
  // No result yet: the run is going if its process is, or if there is no pid and the events are still fresh.
  const pid = readPid(folder)
  const lastWrite = (() => {
    try {
      return statSync(eventsPath).mtimeMs
    } catch {
      return 0
    }
  })()
  const running = pid !== null ? alive(pid) : now() - lastWrite < FRESH_EVENTS_MS
  if (running) return folded
  if (stopped?.has(id)) return { ...folded, outcome: 'stopped', finished: folded.finished ?? new Date(now()).toISOString() }
  return { ...folded, outcome: 'error', message: folded.message ?? 'The run ended without a result.', finished: folded.finished ?? new Date(lastWrite || now()).toISOString() }
}

/** The tools hobkin needs, found without running any of them. Null for one that is missing. */
export function findTools(home: string, env: NodeJS.ProcessEnv = process.env): ProofTools {
  const inPath = (name: string, extra: string[] = []) =>
    [...extra, ...(env.PATH ?? '').split(delimiter)].filter(Boolean).map((dir) => join(dir, name)).find((path) => existsSync(path)) ?? null
  // `hobkin proof setup` puts its Java runtime in tools/java on a Mac without one, the jar in tools/tla and TLAPS in tools/tlaps.
  const java = env.JAVA_HOME && existsSync(join(env.JAVA_HOME, 'bin', 'java')) ? join(env.JAVA_HOME, 'bin', 'java') : inPath('java', [join(home, 'tools', 'java', 'Contents', 'Home', 'bin'), '/opt/homebrew/opt/openjdk/bin', '/usr/local/opt/openjdk/bin'])
  const jar = [env.TLA2TOOLS, join(home, 'tools', 'tla', 'tla2tools.jar')].find((path): path is string => !!path && existsSync(path))
  const tlaps = inPath('tlapm', [join(home, 'tools', 'tlaps', 'bin'), join(home, 'tools', 'tlaps')])
  // macOS ships /usr/bin/java as a stub that only asks for an install, so it is not a Java.
  return { java: java === '/usr/bin/java' ? null : java, tlc: jar ?? null, tlaps }
}

export interface KeeperOptions {
  /** hobkin's home, or null while there is none. */
  home: () => string | null
  /** Asked when the slice changed. */
  onChange: () => void
  tools?: (home: string) => ProofTools | Promise<ProofTools>
  alive?: (pid: number) => boolean
  now?: () => number
  /** Turn the folder watch off: a test of the poll. */
  watch?: boolean
  pollMs?: number
}

/** Keeps the `proofs` slice: reads the folder when it changes and now and then, each run at most twice a second. */
export class ProofsKeeper {
  state: ProofsState = { runs: [] }
  /** Runs the host ended itself because the runtime could not record it. */
  readonly stopped = new Set<string>()
  private readonly options: KeeperOptions
  private readonly cache = new Map<string, { at: number; signature: string; run: ProofRunSummary }>()
  private watcher: FSWatcher | null = null
  private watching: string | null = null
  private timer: NodeJS.Timeout | null = null
  private poll: NodeJS.Timeout
  private last = -Infinity
  private tools: ProofTools | null = null
  private toolsFor: string | null = null
  private closed = false

  constructor(options: KeeperOptions) {
    this.options = options
    this.poll = setInterval(() => this.schedule(), options.pollMs ?? POLL_MS)
    this.poll.unref()
    this.schedule()
  }

  private now = () => (this.options.now ?? Date.now)()

  /** Looks for the tools again, such as after a setup. */
  async findTools(): Promise<void> {
    const home = this.options.home()
    if (!home) return
    try {
      this.tools = await (this.options.tools ?? findTools)(home)
    } catch {
      this.tools = { java: null, tlc: null, tlaps: null }
    }
    this.schedule()
  }

  /** Reads soon, and never twice inside the gap. */
  schedule(): void {
    if (this.closed || this.timer) return
    const wait = Math.max(0, this.last + MIN_GAP_MS - this.now())
    this.timer = setTimeout(() => {
      this.timer = null
      this.scan()
    }, wait)
    this.timer.unref()
  }

  /** The run now, read afresh. */
  run(id: string): ProofRun | null {
    const home = this.options.home()
    return home ? readRun(join(home, 'proofs', id), id, this.readOptions()) : null
  }

  close(): void {
    this.closed = true
    clearInterval(this.poll)
    if (this.timer) clearTimeout(this.timer)
    this.watcher?.close()
  }

  private readOptions(): ReadOptions {
    return { alive: this.options.alive, now: this.options.now, stopped: this.stopped }
  }

  private watchFolder(folder: string): void {
    if (this.options.watch === false || this.watching === folder) return
    this.watcher?.close()
    this.watcher = null
    this.watching = folder
    try {
      this.watcher = watch(folder, { recursive: true }, () => this.schedule())
      this.watcher.on('error', () => {
        this.watcher?.close()
        this.watcher = null
      })
    } catch {
      // The poll still looks.
    }
  }

  private scan(): void {
    this.last = this.now()
    const home = this.options.home()
    const folder = home ? join(home, 'proofs') : null
    if (home && this.toolsFor !== home) {
      this.toolsFor = home
      void this.findTools()
    }
    const ids = folder && existsSync(folder) ? readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : []
    if (folder && ids.length) this.watchFolder(folder)

    const runs: ProofRunSummary[] = []
    for (const id of ids) {
      const run = this.summary(join(folder!, id), id)
      if (run) runs.push(run)
    }
    for (const id of [...this.cache.keys()]) if (!ids.includes(id)) this.cache.delete(id)
    runs.sort((a, b) => Date.parse(b.started || '') - Date.parse(a.started || '') || b.id.localeCompare(a.id))
    const running = runs.filter((run) => run.outcome === 'checking')
    const ended = runs.filter((run) => run.outcome !== 'checking').slice(0, RECENT_RUNS)
    const kept = [...running, ...ended].sort((a, b) => runs.indexOf(a) - runs.indexOf(b))

    const next: ProofsState = { runs: kept, ...(this.tools ? { tools: this.tools } : {}) }
    if (JSON.stringify(next) === JSON.stringify(this.state)) return
    this.state = next
    this.options.onChange()
  }

  /** A run's summary, kept while its files are unchanged and, while it runs, for at least the gap. */
  private summary(folder: string, id: string): ProofRunSummary | null {
    const held = this.cache.get(id)
    const signature = ['result.json', 'events.jsonl', 'pid'].map((name) => {
      try {
        const stat = statSync(join(folder, name))
        return `${stat.mtimeMs}:${stat.size}`
      } catch {
        return '-'
      }
    }).join('|')
    const finished = held?.run.outcome !== undefined && held.run.outcome !== 'checking'
    if (held && held.signature === signature && (finished || this.now() - held.at < MIN_GAP_MS)) return held.run
    const run = readRun(folder, id, this.readOptions())
    if (!run) return null
    const summary = summaryOf(run)
    this.cache.set(id, { at: this.now(), signature, run: summary })
    return summary
  }
}

/** The runtime's own proof functions, each present only when the runtime running now has it. */
export interface ProofRuntime {
  /** Ends a run and records `stopped`. */
  stop?: (input: { home: string; id: string }) => Promise<unknown> | unknown
  /** Starts a check, as `hobkin proof check` does. */
  check?: (input: { home: string; spec: string; cfg?: string; root?: string; project?: string; item?: string; head?: string }) => Promise<unknown> | unknown
  /** Downloads the pinned tools. */
  setup?: (input: { home: string }) => Promise<unknown> | unknown
}

const FUNCTIONS: { key: keyof ProofRuntime; names: string[] }[] = [
  { key: 'stop', names: ['stopProof', 'stopRun', 'stopProofRun'] },
  { key: 'check', names: ['checkProof', 'runProofCheck', 'proofCheck', 'check'] },
  { key: 'setup', names: ['setupProof', 'setupProofTools', 'proofSetup', 'setup'] },
]
const MODULES = ['check', 'record', 'setup', 'tools']

/** The runtime's proof functions through dynamic imports, so a runtime without them leaves the host working. */
export async function loadProofRuntime(): Promise<ProofRuntime> {
  const runtime: ProofRuntime = {}
  for (const file of MODULES) {
    let module: Record<string, unknown>
    try {
      module = (await import(/* @vite-ignore */ `hobkin/src/cli/proof/${file}.mjs`)) as Record<string, unknown>
    } catch {
      continue
    }
    for (const { key, names } of FUNCTIONS) {
      const name = names.find((candidate) => typeof module[candidate] === 'function')
      if (name && !runtime[key]) runtime[key] = module[name] as never
    }
  }
  return runtime
}

export interface ProofSeat {
  keeper: ProofsKeeper
  /** hobkin's home. Throws `Unavailable` while there is none. */
  home: () => string
  runtime?: () => Promise<ProofRuntime>
  alive?: (pid: number) => boolean
  kill?: (pid: number, signal: NodeJS.Signals) => void
  graceMs?: number
  pauseMs?: number
}

type ProofCommand = 'proof.get' | 'proof.stop' | 'proof.again' | 'proof.setup'

const messageOf = (value: unknown): string | null => {
  if (typeof value === 'string') return value
  const message = asObject(value).message
  return typeof message === 'string' ? message : null
}

export function proofHandlers({ keeper, home, runtime = loadProofRuntime, alive = pidAlive, kill = (pid, signal) => process.kill(pid, signal), graceMs = STOP_GRACE_MS, pauseMs = 50 }: ProofSeat): Pick<HostHandlers, ProofCommand> {
  const missing = (what: string) => new Unavailable(`The hobkin running now cannot ${what}. Restart hobkin so it loads the version with TLA+ proofs.`)
  const read = (id: string) => {
    const run = keeper.run(id)
    if (!run) throw new Error(`There is no proof run ${id}.`)
    return run
  }
  const refreshed = () => {
    keeper.schedule()
  }

  return {
    'proof.get': ({ id }) => read(id),
    'proof.stop': async ({ id }) => {
      const folder = join(home(), 'proofs', id)
      const run = read(id)
      if (run.outcome !== 'checking') return { message: `Run ${id} had already ended: ${run.outcome}.` }
      const pid = readPid(folder)
      const recorder = (await runtime()).stop
      // The runtime ends the process and records `stopped`.
      let recorded = false
      let failure: unknown = null
      if (recorder) {
        try {
          await recorder({ home: home(), id })
          recorded = true
        } catch (error) {
          failure = error
        }
      }
      // Whatever it did, the process ends within the grace: asked first, then killed.
      if (pid !== null && alive(pid)) {
        try {
          kill(pid, 'SIGTERM')
        } catch {
          // Gone already.
        }
        for (let waited = 0; alive(pid) && waited < graceMs; waited += pauseMs) await new Promise((resolve) => setTimeout(resolve, pauseMs))
        if (alive(pid)) {
          try {
            kill(pid, 'SIGKILL')
          } catch {
            // Gone already.
          }
        }
      }
      if (!recorded) keeper.stopped.add(id)
      refreshed()
      if (recorded) return { message: `Stopped run ${id}.` }
      const why = failure instanceof Error ? failure.message : 'this hobkin cannot record it'
      return { message: `Stopped run ${id}, but it is not recorded as stopped: ${why}.` }
    },
    'proof.again': async ({ id }) => {
      const run = read(id)
      const folder = join(home(), 'proofs', id)
      const check = (await runtime()).check
      if (!check) throw missing('start a proof check')
      // The spec and cfg paths are relative to the checkout the run happened in.
      const { cfg, root } = readJson(join(folder, 'result.json')) ?? {}
      const said = await check({
        home: home(),
        spec: run.spec,
        ...(typeof cfg === 'string' ? { cfg } : {}),
        ...(typeof root === 'string' ? { root } : {}),
        ...(run.project ? { project: run.project } : {}),
        ...(run.item ? { item: run.item } : {}),
      })
      refreshed()
      const started = asObject(said).id
      return { message: messageOf(said) ?? `Started the check of ${run.spec} again.`, ...(typeof started === 'string' ? { id: started } : {}) }
    },
    'proof.setup': async () => {
      const setup = (await runtime()).setup
      if (!setup) throw missing('set up the proof tools')
      const said = await setup({ home: home() })
      await keeper.findTools()
      return { message: messageOf(said) ?? 'The proof tools are ready.' }
    },
  }
}
