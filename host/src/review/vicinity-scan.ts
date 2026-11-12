/**
 * The vicinity of a change, from agentic-search: the request's life cycle around it, mapped by static call-graph
 * scans. The first scans the change at its commits. It reads the changed files at head; callers and the files the
 * change left alone it reads in the project's folder. Each scan after it starts from the callers found so far, given
 * as places in that folder, so the life cycle goes out a call at a time until it reaches where a request enters or
 * goes past the hops it may take. Only calls the type checker or an index proved are kept as they are; a caller
 * matched by name alone is kept only where the scan has nothing better, and says so. What the changed lines call is
 * kept too, a few for each definition, the most telling first. Nothing here is shown as it is: the review finds
 * every definition again at head and checks every call there (`shared/review/vicinity.ts`). A scan that cannot run
 * leaves a notice and nothing else, so a review is never held up by it.
 */
import { spawn } from 'node:child_process'
import { accessSync, constants, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { splitLines } from '#shared/review/lines.ts'
import { isTestPath } from '#shared/review/paths.ts'
import { isSafePath } from '#shared/review/prose.ts'
import type { ReviewEntry } from '#shared/review/types.ts'
import { LIFE_CYCLE, type Vicinity, type VicinityDefinition, type VicinityGuard, type VicinityLeft, type VicinityLink } from '#shared/review/vicinity.ts'
import { gitReader } from './git.ts'

/** Runs agentic-search with these arguments, for at most `timeoutMs`: what it wrote, or why it could not. */
export type ScanRun = (args: readonly string[], options?: { timeoutMs?: number }) => Promise<{ ok: true; stdout: string } | { ok: false; reason: string }>

export const SCAN_TIMEOUT_MS = 60_000
/** How long all the scans of one change may take together. */
export const VICINITY_BUDGET_MS = 120_000
/** A scan further out is started only with at least this long left. */
const LEAST_SCAN_MS = 5_000
/** The most callers one scan further out starts from. */
const MOST_PER_SCAN = 20
const MAX_OUTPUT = 32 * 1024 * 1024

/** Where agentic-search is found when the app's PATH does not have it: pnpm's and Homebrew's folders. */
const PLACES = [join(homedir(), 'Library', 'pnpm', 'bin'), join(homedir(), '.local', 'share', 'pnpm'), '/opt/homebrew/bin', '/usr/local/bin']

export function findAgenticSearch({ path = process.env.PATH ?? '', places = PLACES }: { path?: string; places?: readonly string[] } = {}): string | null {
  for (const folder of [...path.split(delimiter), ...places]) {
    if (!folder) continue
    const file = join(folder, 'agentic-search')
    try {
      accessSync(file, constants.X_OK)
      if (statSync(file).isFile()) return file
    } catch {
      // Not here.
    }
  }
  return null
}

/** agentic-search as a program of its own, never through a shell, stopped when it takes too long. */
export function spawnScan({ file, timeoutMs = SCAN_TIMEOUT_MS }: { file?: string | null; timeoutMs?: number } = {}): ScanRun {
  return (args, options) =>
    new Promise((resolve) => {
      const program = file === undefined ? findAgenticSearch() : file
      if (!program) return resolve({ ok: false, reason: 'agentic-search is not installed.' })
      const limit = options?.timeoutMs ?? timeoutMs
      // GIT_OPTIONAL_LOCKS: the scan only reads, so git never writes the index of a folder someone else is working in.
      const child = spawn(program, [...args], { env: { ...process.env, NO_COLOR: '1', GIT_OPTIONAL_LOCKS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
      const out: Buffer[] = []
      const err: Buffer[] = []
      let size = 0
      let settled = false
      const finish = (outcome: Awaited<ReturnType<ScanRun>>) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(outcome)
      }
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        finish({ ok: false, reason: `the scan took longer than ${Math.round(limit / 1000)} seconds.` })
      }, limit)
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_OUTPUT) {
          child.kill('SIGTERM')
          return finish({ ok: false, reason: 'the scan wrote more than expected.' })
        }
        out.push(chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
      child.on('error', (error) => finish({ ok: false, reason: error.message }))
      child.on('close', (code) => {
        if (code === 0) return finish({ ok: true, stdout: Buffer.concat(out).toString('utf8') })
        const said = Buffer.concat(err).toString('utf8').trim().split('\n')[0]?.replace(/^agentic-search:\s*/, '')
        finish({ ok: false, reason: said || `it stopped with code ${code}.` })
      })
    })
}

// ───────────────────────── Reading a pack, without trust ─────────────────────────

interface Definition extends VicinityDefinition {
  id: string
  kind: string
  language: string
  entry?: ReviewEntry
}

interface Caller {
  id: string
  line: number
  proven: boolean
  guards: VicinityGuard[]
  enqueues: boolean
  changed: boolean
  boundary: boolean
}

interface Anchor extends Definition {
  changedLines: number[]
  callers: Caller[]
  /** How many production call sites the scan found, and whether it listed them all. */
  count: { total: number; complete: boolean }
}

interface Edge {
  from: string
  to: string
  relationship: string
  proven: boolean
  byName: boolean
  line: number
  guards: VicinityGuard[]
}

interface Pack {
  nodes: Map<string, Definition>
  anchors: Anchor[]
  edges: Edge[]
  files: Set<string>
  stopped: string | null
}

type Raw = Record<string, unknown>
const record = (value: unknown): Raw | undefined => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : undefined)
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)
const line = (value: unknown): number | undefined => (Number.isInteger(value) && (value as number) > 0 ? (value as number) : undefined)

function definitionOf(value: unknown): Definition | undefined {
  const raw = record(value)
  const [id, path, symbol, startLine, endLine] = [text(raw?.id), text(raw?.path), text(raw?.symbol), line(raw?.startLine), line(raw?.endLine)]
  if (!raw || !id || !path || !symbol || !startLine || !endLine || endLine < startLine) return undefined
  const entry = record(raw.entry)
  return { id, path, symbol, startLine, endLine, kind: text(raw.kind) ?? '', language: text(raw.language) ?? '', ...(entry && text(entry.kind) ? { entry: { kind: text(entry.kind)!, exact: entry.exact === true } } : {}) }
}

const BRANCHES = new Set(['then', 'else', 'after-return'])
const guardsOf = (value: unknown): VicinityGuard[] =>
  list(value).flatMap((item) => {
    const raw = record(item)
    const [at, said, branch] = [line(raw?.line), text(raw?.text), text(raw?.branch)]
    return at && said && branch && BRANCHES.has(branch) ? [{ line: at, text: said, branch: branch as VicinityGuard['branch'] }] : []
  })

function readPack(details: unknown): Pack | undefined {
  const raw = record(details)
  if (!raw) return undefined
  const nodes = new Map(list(raw.nodes).flatMap((item) => {
    const definition = definitionOf(item)
    return definition ? [[definition.id, definition] as const] : []
  }))
  const anchors = list(raw.anchors).flatMap((item): Anchor[] => {
    const definition = definitionOf(item)
    const anchor = record(item)
    if (!definition || !anchor) return []
    const counted = record(anchor.callerCount)
    const callers = list(anchor.callers).flatMap((entry): Caller[] => {
      const site = record(entry)
      const [id, at] = [text(site?.id), line(site?.line)]
      if (!site || !id || !at || site.test === true) return []
      return [{ id, line: at, proven: site.resolution === 'exact', guards: guardsOf(site.guards), enqueues: site.enqueue === true, changed: site.changed === true, boundary: list(site.boundary).length > 0 }]
    })
    const known = nodes.get(definition.id)
    return [{
      ...definition,
      language: definition.language || known?.language || '',
      ...(definition.entry ?? known?.entry ? { entry: definition.entry ?? known?.entry } : {}),
      changedLines: list(anchor.changedLines).flatMap((at) => (line(at) ? [at as number] : [])),
      callers,
      count: { total: Number.isInteger(counted?.total) ? (counted!.total as number) : callers.length, complete: counted?.complete === true },
    }]
  })
  const edges = list(raw.edges).flatMap((item): Edge[] => {
    const edge = record(item)
    const [from, to, at, relationship] = [text(edge?.from), text(edge?.to), line(edge?.line), text(edge?.relationship)]
    if (!edge || !from || !to || !at || !relationship) return []
    return [{ from, to, relationship, proven: edge.resolution === 'exact', byName: edge.resolution === 'static_candidate', line: at, guards: guardsOf(edge.guards) }]
  })
  const files = new Set(list(raw.files).flatMap((item) => (text(record(item)?.path) ? [text(record(item)?.path)!] : [])))
  const truncated = record(raw.coverage)?.truncatedBy
  return { nodes, anchors, edges, files, stopped: typeof truncated === 'string' && truncated !== 'none' ? truncated : null }
}

// ───────────────────────── Choosing the life cycle ─────────────────────────

/** A caller is kept as proven, or, where only an index could prove it and none did (Ruby), by a name rare enough to trust. */
const RARE_NAME = 3
/** What runs as its file loads, so a request's way through the code starts there. */
const LOADS = new Set(['statement'])
/** A type is no code that runs. */
const TYPES = new Set(['type', 'interface'])

const declaredName = (symbol: string) => symbol.split(/::|[.#]/).at(-1) ?? symbol
const placeOf = (definition: VicinityDefinition) => `${definition.path}:${definition.startLine}`
const entryOf = (definition: Definition): ReviewEntry | undefined => definition.entry ?? (LOADS.has(definition.kind) ? { kind: 'load', exact: true } : undefined)

/** A link with what decides its place in the list: the way out first, then what the change calls, then the rest. */
interface Ranked {
  link: VicinityLink
  tier: number
  /** The changed definition it hangs off, in the scan's order. */
  root: number
}

/** A caller found, whose own callers a scan further out may look for. */
interface Frontier {
  definition: Definition
  root: number
  /** On the way out by the best caller at each call. */
  spine: boolean
  /** The first scan read it at head, in a changed file, so the project's folder may have it on another line. */
  atHead: boolean
}

interface Cycle {
  ranked: Ranked[]
  frontier: Frontier[]
  /** Every caller already found, by place, so the life cycle never looks for one twice. */
  seen: Set<string>
  left: Required<VicinityLeft>
}

/** The callers of one definition worth showing, best first: where a request enters, then proven, then a boundary, then another file. */
function callersOf(anchor: Anchor, nodes: Map<string, Definition>, left: Required<VicinityLeft>): { caller: Caller; definition: Definition }[] {
  const usable = anchor.callers.flatMap((caller) => {
    const definition = nodes.get(caller.id)
    if (!definition || caller.changed || caller.id === anchor.id || isTestPath(definition.path)) return []
    // The type checker sees every call in JavaScript and TypeScript, so a caller it did not prove is another function of that name.
    const trusted = caller.proven || (anchor.language === 'ruby' && anchor.count.total <= RARE_NAME)
    if (!trusted) {
      left.byName += 1
      return []
    }
    return [{ caller, definition }]
  })
  if (!anchor.count.complete) left.partial += 1
  const score = ({ caller, definition }: (typeof usable)[number]) => [entryOf(definition) ? 0 : 1, caller.proven ? 0 : 1, caller.boundary ? 0 : 1, definition.path === anchor.path ? 1 : 0] as const
  const sorted = usable.sort((a, b) => {
    const [x, y] = [score(a), score(b)]
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3] || a.definition.path.localeCompare(b.definition.path) || a.caller.line - b.caller.line
  })
  left.perDefinition += Math.max(0, sorted.length - LIFE_CYCLE.callers)
  return sorted.slice(0, LIFE_CYCLE.callers)
}

/** Adds the callers of a definition, as links one call further out, and puts them on the frontier. */
function addCallers(cycle: Cycle, anchor: Anchor, nodes: Map<string, Definition>, from: { near: VicinityLink['near']; hops: number; root: number; spine: boolean; changedFiles: Set<string> }) {
  callersOf(anchor, nodes, cycle.left).forEach(({ caller, definition }, index) => {
    const spine = from.spine && index === 0
    const entry = entryOf(definition)
    const link: VicinityLink = {
      near: from.near,
      other: { path: definition.path, symbol: definition.symbol, startLine: definition.startLine, endLine: definition.endLine },
      direction: 'caller',
      hops: from.hops,
      call: { line: caller.line, name: declaredName(anchor.symbol), ...(caller.guards.length ? { guards: caller.guards } : {}), ...(caller.enqueues ? { enqueues: true } : {}) },
      proven: caller.proven,
      ...(entry ? { entry } : {}),
    }
    cycle.ranked.push({ link, tier: spine ? 0 : 2, root: from.root })
    // Where a request enters, nothing further out is looked for. A caller already found is looked into once.
    if (entry || cycle.seen.has(placeOf(definition))) return
    cycle.seen.add(placeOf(definition))
    cycle.frontier.push({ definition, root: from.root, spine, atHead: from.hops === 1 && from.changedFiles.has(definition.path) })
  })
}

/** The first call out from each changed definition: its callers, and what its changed lines call. */
function firstCalls(pack: Pack): Cycle & { entries: NonNullable<Vicinity['entries']> } {
  const cycle: Cycle = { ranked: [], frontier: [], seen: new Set(), left: { byName: 0, perDefinition: 0, further: 0, partial: 0 } }
  const entries: NonNullable<Vicinity['entries']> = []
  const changedIds = new Set(pack.anchors.map((anchor) => anchor.id))
  pack.anchors
    .filter((anchor) => !isTestPath(anchor.path) && anchor.changedLines.length > 0)
    .forEach((anchor, root) => {
      const changed = { path: anchor.path, line: anchor.changedLines[0]! }
      if (anchor.entry) entries.push({ changed, entry: anchor.entry })
      addCallers(cycle, anchor, pack.nodes, { near: { changed }, hops: 1, root, spine: true, changedFiles: pack.files })

      const callees = new Map<string, { edge: Edge; definition: Definition }>()
      for (const edge of pack.edges) {
        if (edge.from !== anchor.id || !anchor.changedLines.includes(edge.line) || (edge.relationship !== 'calls' && edge.relationship !== 'enqueues')) continue
        const definition = pack.nodes.get(edge.to)
        if (!definition || changedIds.has(definition.id) || callees.has(definition.id) || TYPES.has(definition.kind) || isTestPath(definition.path)) continue
        if (!edge.proven && !(edge.byName && anchor.language === 'ruby')) continue
        callees.set(definition.id, { edge, definition })
      }
      const sorted = [...callees.values()].sort(
        (a, b) => Number(b.edge.relationship === 'enqueues') - Number(a.edge.relationship === 'enqueues') || Number(a.definition.path === anchor.path) - Number(b.definition.path === anchor.path) || a.edge.line - b.edge.line,
      )
      cycle.left.perDefinition += Math.max(0, sorted.length - LIFE_CYCLE.callees)
      for (const { edge, definition } of sorted.slice(0, LIFE_CYCLE.callees)) {
        const link: VicinityLink = {
          near: { changed: { path: anchor.path, line: edge.line } },
          other: { path: definition.path, symbol: definition.symbol, startLine: definition.startLine, endLine: definition.endLine },
          direction: 'callee',
          hops: 1,
          call: { line: edge.line, name: declaredName(definition.symbol), ...(edge.guards.length ? { guards: edge.guards } : {}), ...(edge.relationship === 'enqueues' ? { enqueues: true } : {}) },
          proven: edge.proven,
        }
        cycle.ranked.push({ link, tier: 1, root })
      }
    })
  return { ...cycle, entries }
}

/**
 * Where the project's folder has a definition the first scan read at head: its first line, found in the folder's copy
 * of the file. Null when the folder does not have that line exactly once.
 */
async function lineInFolder(definition: Definition, readHead: (path: string) => Promise<string | null>, readFolder: (path: string) => string | null): Promise<number | null> {
  const [atHead, inFolder] = [await readHead(definition.path), readFolder(definition.path)]
  const first = atHead == null ? undefined : splitLines(atHead)[definition.startLine - 1]?.trim()
  if (!first || inFolder == null) return null
  const found = splitLines(inFolder).flatMap((entry, index) => (entry.trim() === first ? [index + 1] : []))
  return found.length === 1 ? found[0]! : null
}

/** The life cycle's links in the order the review shows them, and what was left out. */
function finish(cycle: Cycle, entries: NonNullable<Vicinity['entries']>, notes: string[]): Vicinity {
  const links = cycle.ranked
    .map((ranked, order) => ({ ...ranked, order }))
    .sort((a, b) => a.tier - b.tier || (a.tier === 2 ? a.link.hops - b.link.hops || a.root - b.root : a.root - b.root || a.link.hops - b.link.hops) || a.order - b.order)
    .map(({ link }) => link)
  const notice = notes.join(' ')
  return { links, ...(entries.length ? { entries } : {}), ...(notice ? { notice } : {}), left: cycle.left }
}

/**
 * Maps the request's life cycle around the change from `base` to `head` in `repo`. Every pack holds source, so each is
 * written to a folder of its own and removed.
 */
export async function scanVicinity({
  repo,
  base,
  head,
  run = spawnScan(),
  readHead = (path) => gitReader(repo).text(head, path),
  readFolder = (path) => {
    if (!isSafePath(path)) return null
    try {
      return readFileSync(join(repo, path), 'utf8')
    } catch {
      return null
    }
  },
  now = Date.now,
  budgetMs = VICINITY_BUDGET_MS,
}: {
  repo: string
  base: string
  head: string
  run?: ScanRun
  /** A file at head, for finding a definition of a changed file in the project's folder. */
  readHead?: (path: string) => Promise<string | null>
  /** A file as the project's folder has it now. */
  readFolder?: (path: string) => string | null
  now?: () => number
  budgetMs?: number
}): Promise<Vicinity> {
  const notShown = (why: string): Vicinity => ({ links: [], notice: `Callers and callees are not shown: ${why}` })
  const started = now()
  const remaining = () => budgetMs - (now() - started)
  const folder = mkdtempSync(join(tmpdir(), 'hobkin-review-scan-'))
  let packs = 0
  const scan = async (target: string[], limits: string[], timeoutMs: number): Promise<{ pack: Pack } | { reason: string }> => {
    const answer = await run(['scan', ...target, '--cwd', repo, '--json', ...limits, '--output-dir', join(folder, `pack-${(packs += 1)}`)], { timeoutMs })
    if (!answer.ok) return { reason: answer.reason }
    try {
      const pack = readPack((JSON.parse(answer.stdout) as { details?: unknown }).details)
      return pack ? { pack } : { reason: 'the scan answered without its details.' }
    } catch {
      return { reason: 'the scan answered with something other than its report.' }
    }
  }
  const stoppedEarly = (pack: Pack) => (pack.stopped ? [`The call-graph scan stopped early (${pack.stopped}), so some callers and callees may be missing.`] : [])

  try {
    // What the change calls and what calls it: the changed lines and their definitions, read at head.
    const first = await scan(['--diff', `${base}..${head}`], ['--max-depth', '1', '--max-anchors', '60', '--max-nodes', '120', '--budget-ms', '30000'], SCAN_TIMEOUT_MS)
    if (!('pack' in first)) return notShown(first.reason)
    const cycle = firstCalls(first.pack)
    const notes = stoppedEarly(first.pack)

    for (let hop = 2; hop <= LIFE_CYCLE.hops && cycle.frontier.length > 0; hop += 1) {
      const wanted = cycle.frontier.sort((a, b) => Number(b.spine) - Number(a.spine) || a.root - b.root)
      cycle.frontier = []
      const time = Math.min(SCAN_TIMEOUT_MS, remaining())
      if (time < LEAST_SCAN_MS) {
        cycle.left.further += wanted.length
        notes.push(`The callers further out than ${hop - 1} call${hop - 1 === 1 ? '' : 's'} are not shown: the scans used the time they had.`)
        break
      }
      const starts: { from: Frontier; line: number }[] = []
      for (const from of wanted) {
        const at = from.atHead ? await lineInFolder(from.definition, readHead, readFolder) : from.definition.startLine
        if (at != null && starts.length < MOST_PER_SCAN) starts.push({ from, line: at })
        else cycle.left.further += 1
      }
      if (starts.length === 0) break
      const next = await scan(starts.flatMap(({ from, line: at }) => ['--anchor', `${from.definition.path}:${at}`]), ['--max-depth', '1', '--max-anchors', String(starts.length), '--max-nodes', '60', '--budget-ms', '20000'], time)
      if (!('pack' in next)) {
        cycle.left.further += starts.length
        notes.push(`The callers further out than ${hop - 1} call${hop - 1 === 1 ? '' : 's'} are not shown: ${next.reason}`)
        break
      }
      notes.push(...stoppedEarly(next.pack).filter((note) => !notes.includes(note)))
      for (const { from, line: at } of starts) {
        const anchor = next.pack.anchors.find((entry) => entry.path === from.definition.path && entry.startLine <= at && at <= entry.endLine)
        if (!anchor) continue
        addCallers(cycle, anchor, next.pack.nodes, { near: { definition: { path: from.definition.path, symbol: from.definition.symbol, startLine: from.definition.startLine, endLine: from.definition.endLine } }, hops: hop, root: from.root, spine: from.spine, changedFiles: first.pack.files })
      }
    }
    cycle.left.further += cycle.frontier.length
    return finish(cycle, cycle.entries, notes)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}
