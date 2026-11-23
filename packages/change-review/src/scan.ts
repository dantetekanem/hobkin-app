/**
 * The scan: what `agentic-search scan` reports about a change. Its pack is the tool's own format and grows with each
 * version, so it is read without trust: the parts the review needs are kept, anything of an unexpected shape is left
 * out and counted, and the coverage says when what was kept is not the whole picture. The tool only searches; nothing
 * here grades what it found.
 */
import { accessSync, constants, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { runProgram } from './git.ts'
import type { CallSite, Dangling, Guard, Scan, ScanAnchor, ScanEdge, ScanEntry, TestDefinition } from './types.ts'

// ───────────────────────── Reading a pack ─────────────────────────

type Raw = Record<string, unknown>

const record = (value: unknown): Raw | undefined => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : undefined)
const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const name = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)
const line = (value: unknown): number | undefined => (Number.isInteger(value) && (value as number) > 0 ? (value as number) : undefined)
const flag = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined)
const items = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/** Every item read, or undefined when any one has an unexpected shape: a partial list would read as the whole. */
function all<T>(value: unknown, read: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value)) return undefined
  const kept = value.map(read)
  return kept.every((item) => item !== undefined) ? (kept as T[]) : undefined
}

/** The kinds of item a pack can lose, in the order the coverage note names them. */
const LOST = ['anchor', 'anchor field', 'anchor test', 'node', 'edge', 'dangling entry', 'test group', 'test entry', 'test definition', 'file'] as const
type Lost = (typeof LOST)[number]

/** What was left out, per kind of item, for the coverage note. */
class Tally {
  private readonly counts = new Map<Lost, number>()
  add(what: Lost) {
    this.counts.set(what, this.get(what) + 1)
  }
  get(what: Lost) {
    return this.counts.get(what) ?? 0
  }
  note(): string | undefined {
    const said = LOST.filter((what) => this.get(what)).map((what) => `${this.get(what)} ${what}${this.get(what) === 1 ? '' : 's'}`)
    return said.length ? `Left out for an unexpected shape: ${said.join(', ')}.` : undefined
  }
}

/** Keeps what `read` makes of each item, counting the ones it cannot read. */
function each<T>(value: unknown, what: Lost, tally: Tally, read: (item: unknown) => T | undefined): T[] {
  const kept: T[] = []
  for (const item of items(value)) {
    const done = read(item)
    if (done === undefined) tally.add(what)
    else kept.push(done)
  }
  return kept
}

const BRANCHES = new Set(['then', 'else', 'after-return'])
const EFFECTS = new Set(['write', 'enqueue', 'cache'])

function guardOf(value: unknown): Guard | undefined {
  const raw = record(value)
  const at = line(raw?.line)
  const said = text(raw?.text)
  const branch = text(raw?.branch)
  if (at === undefined || said === undefined || branch === undefined || !BRANCHES.has(branch)) return undefined
  return { line: at, text: said, branch: branch as Guard['branch'] }
}

function routeOf(value: unknown): NonNullable<ScanEntry['routes']>[number] | undefined {
  const raw = record(value)
  const verbs = all(raw?.verbs, name)
  const path = name(raw?.path)
  const file = name(raw?.file)
  const at = line(raw?.line)
  return verbs?.length && path && file && at !== undefined ? { verbs, path, file, line: at } : undefined
}

function doorOf(value: unknown): NonNullable<ScanEntry['doors']>[number] | undefined {
  const raw = record(value)
  const kind = name(raw?.kind)
  const title = name(raw?.title)
  const file = name(raw?.file)
  const at = line(raw?.line)
  return kind && title && file && at !== undefined ? { kind, title, file, line: at } : undefined
}

/**
 * Where work enters, as the tool says: a kind and whether it is sure, with its words, routes and doors when each has
 * the expected shape. A kind this reader does not know is kept as the tool names it. Routes or doors of an odd shape
 * are left out whole, and the entry is still one.
 */
function entryOf(value: unknown): ScanEntry | undefined {
  const raw = record(value)
  const kind = name(raw?.kind)
  const exact = flag(raw?.exact)
  if (!raw || !kind || exact === undefined) return undefined
  const label = name(raw.label) ?? name(raw.key)
  const routes = all(raw.routes, routeOf)
  const doors = all(raw.doors, doorOf)
  return { kind, exact, ...(label ? { label } : {}), ...(routes?.length ? { routes } : {}), ...(doors?.length ? { doors } : {}) }
}

/** A call site: its place and its guards (none when the tool reports none). A site of a test is not a caller of the code. */
function callSiteOf(value: unknown): CallSite | undefined {
  const raw = record(value)
  const id = name(raw?.id)
  const symbol = text(raw?.symbol)
  const path = name(raw?.path)
  const at = line(raw?.line)
  const guards = raw?.guards === undefined ? [] : all(raw.guards, guardOf)
  if (!raw || !id || symbol === undefined || !path || at === undefined || !guards) return undefined
  const said = text(raw.text)
  const resolution = name(raw.resolution)
  const entry = entryOf(raw.entry)
  return {
    id,
    symbol,
    path,
    line: at,
    ...(said !== undefined ? { text: said } : {}),
    ...(resolution ? { resolution } : {}),
    guards,
    ...(raw.enqueue === true ? { enqueue: true } : {}),
    ...(entry ? { entry } : {}),
  }
}

function lineGuardsOf(value: unknown): { line: number; guards: Guard[] } | undefined {
  const raw = record(value)
  const at = line(raw?.line)
  const guards = all(raw?.guards, guardOf)
  return at !== undefined && guards ? { line: at, guards } : undefined
}

function effectOf(value: unknown): NonNullable<ScanAnchor['effects']>[number] | undefined {
  const raw = record(value)
  const kind = text(raw?.kind)
  const at = line(raw?.line)
  const said = text(raw?.text)
  if (!kind || !EFFECTS.has(kind) || at === undefined || said === undefined) return undefined
  return { kind: kind as 'write' | 'enqueue' | 'cache', line: at, text: said }
}

function removedOf(value: unknown): { oldStart: number; lines: string[] } | undefined {
  const raw = record(value)
  const oldStart = line(raw?.oldStart)
  const lines = all(raw?.lines, text)
  return oldStart !== undefined && lines ? { oldStart, lines } : undefined
}

function testRefOf(value: unknown): ScanAnchor['tests'][number] | undefined {
  const raw = record(value)
  const id = name(raw?.id)
  const symbol = text(raw?.symbol)
  const path = name(raw?.path)
  const at = line(raw?.line)
  return id && symbol !== undefined && path && at !== undefined ? { id, symbol, path, line: at } : undefined
}

/**
 * The newer, optional anchor fields, each only when its whole value has the expected shape. A call-site list under
 * `callers`, with no `callerCount`, is how packs before the count reported callers: it is not a count, so none is made.
 */
function optionalFields(raw: Raw, tally: Tally): Partial<ScanAnchor> {
  const fields: Partial<ScanAnchor> = {}
  const keep = <K extends keyof ScanAnchor>(key: K, value: ScanAnchor[K] | undefined) => {
    if (raw[key] === undefined) return
    if (value === undefined) tally.add('anchor field')
    else fields[key] = value
  }
  keep('removed', all(raw.removed, removedOf))
  const status = text(raw.status)
  keep('status', status === 'added' || status === 'modified' ? status : undefined)
  keep('whitespaceOnly', all(raw.whitespaceOnly, line))
  keep('signatureChanged', flag(raw.signatureChanged))
  keep('guards', all(raw.guards, lineGuardsOf))
  keep('effects', all(raw.effects, effectOf))
  keep('loadTime', flag(raw.loadTime))
  keep('entry', entryOf(raw.entry))
  const semanticFingerprint = name(raw.semanticFingerprint)
  if (semanticFingerprint) fields.semanticFingerprint = semanticFingerprint
  // The call-site list is `callers` itself, with a count beside it in newer packs. A partly read list would read as
  // every caller, so it goes whole. A site of a test is no caller of the code, but that tests call it is counted.
  if (Array.isArray(raw.callers)) {
    const sites = all(raw.callers.filter((item) => record(item)?.test !== true), callSiteOf)
    if (sites) fields.callSites = sites
    const tested = raw.callers.filter((item) => record(item)?.test === true).length
    if (tested) fields.testCallers = tested
  }
  const counted = record(raw.callerCount) ?? (Array.isArray(raw.callers) ? undefined : record(raw.callers))
  if (counted) {
    const total = Number.isInteger(counted.total) ? (counted.total as number) : undefined
    const shown = Number.isInteger(counted.shown) ? (counted.shown as number) : undefined
    const complete = flag(counted.complete)
    const value = total !== undefined && shown !== undefined && complete !== undefined ? { total, shown, complete } : undefined
    if (value) fields.callers = value
    else tally.add('anchor field')
  }
  return fields
}

/** An anchor needs its place and every changed line; without them it is left out, never guessed. */
function anchorOf(value: unknown, languageOf: (id: string, path: string) => string | undefined, tally: Tally): ScanAnchor | undefined {
  const raw = record(value)
  if (!raw) return undefined
  const id = name(raw.id)
  const symbol = text(raw.symbol)
  const kind = name(raw.kind)
  const path = name(raw.path)
  const startLine = line(raw.startLine)
  const endLine = line(raw.endLine)
  const changedLines = all(raw.changedLines, line)
  const hasPlace = id && kind && path && startLine !== undefined && endLine !== undefined && endLine >= startLine
  if (!hasPlace || symbol === undefined || !changedLines) return undefined
  const language = text(raw.language) ?? languageOf(id, path)
  return {
    id,
    symbol,
    kind,
    path,
    startLine,
    endLine,
    changedLines,
    ...(language ? { language } : {}),
    ...optionalFields(raw, tally),
    tests: each(raw.tests, 'anchor test', tally, testRefOf),
  }
}

function nodeOf(value: unknown): Scan['nodes'][string] | undefined {
  const raw = record(value)
  const id = name(raw?.id)
  const symbol = text(raw?.symbol)
  const kind = name(raw?.kind)
  const path = name(raw?.path)
  const startLine = line(raw?.startLine)
  const endLine = line(raw?.endLine)
  if (!id || symbol === undefined || !kind || !path || startLine === undefined || endLine === undefined) return undefined
  const entry = entryOf(raw?.entry)
  return { id, symbol, kind, path, startLine, endLine, ...(entry ? { entry } : {}) }
}

/** A test that references changed definitions: its place, and which of them it references on which lines. */
function testDefinitionOf(value: unknown): TestDefinition | undefined {
  const raw = record(value)
  const id = name(raw?.id)
  const symbol = text(raw?.symbol)
  const path = name(raw?.path)
  const startLine = line(raw?.startLine)
  const endLine = line(raw?.endLine)
  const anchors = all(raw?.anchors, (item) => {
    const anchor = record(item)
    const of = name(anchor?.id)
    const lines = all(anchor?.lines, line)
    return of && lines ? { id: of, lines } : undefined
  })
  const changed = flag(raw?.changed)
  if (!id || symbol === undefined || !path || startLine === undefined || endLine === undefined || !anchors || changed === undefined) return undefined
  return { id, symbol, path, startLine, endLine, anchors, changed }
}

/** An edge needs its source and what kind of link it is; the target is absent for calls nothing in the repository defines. */
function edgeOf(value: unknown): ScanEdge | undefined {
  const raw = record(value)
  const from = name(raw?.from)
  const relationship = name(raw?.relationship)
  const resolution = name(raw?.resolution)
  if (!raw || !from || !relationship || !resolution) return undefined
  const to = name(raw.to)
  const called = text(raw.name)
  const at = line(raw.line)
  const note = text(raw.note)
  const reason = text(raw.reason)
  const via = name(raw.via)
  const guards = raw.guards === undefined ? undefined : all(raw.guards, guardOf)
  return {
    from,
    ...(to ? { to } : {}),
    ...(called !== undefined ? { name: called } : {}),
    relationship,
    resolution,
    ...(at !== undefined ? { line: at } : {}),
    ...(note !== undefined ? { note } : {}),
    ...(reason !== undefined ? { reason } : {}),
    ...(guards ? { guards } : {}),
    ...(via ? { via } : {}),
  }
}

function referenceOf(value: unknown): Dangling['references'][number] | undefined {
  const raw = record(value)
  const path = name(raw?.path)
  const at = line(raw?.line)
  return path && at !== undefined ? { path, line: at, text: text(raw?.text) ?? '' } : undefined
}

/**
 * A removed definition something still refers to. Today's pack writes `name`, `oldPath`, `stillDefined` and `callers`;
 * the contract's own shape is read too. A name still defined elsewhere, or that nothing refers to, is not dangling.
 */
function danglingOf(value: unknown): Dangling | null | undefined {
  const raw = record(value)
  if (!raw) return undefined
  if (raw.stillDefined === true) return null
  const symbol = name(raw.symbol) ?? name(raw.name)
  const path = name(raw.path) ?? name(raw.oldPath)
  const references = all(raw.references ?? raw.callers, referenceOf)
  if (!symbol || !path || !references) return undefined
  return references.length ? { symbol, path, references } : null
}

function testGroupOf(value: unknown, tally: Tally): Scan['tests'][number] | undefined {
  const raw = record(value)
  const path = name(raw?.path)
  if (!path) return undefined
  const entries = each(raw?.entries, 'test entry', tally, (item) => {
    const entry = record(item)
    const symbol = text(entry?.symbol)
    const startLine = line(entry?.startLine)
    const endLine = line(entry?.endLine)
    return symbol !== undefined && startLine !== undefined && endLine !== undefined ? { symbol, startLine, endLine } : undefined
  })
  return { path, entries }
}

function fileOf(value: unknown): (Scan['files'][number] & { language?: string }) | undefined {
  const raw = record(value)
  const path = name(raw?.path)
  const kind = name(raw?.kind)
  const status = name(raw?.status)
  return path && kind && status ? { path, kind, status, ...(text(raw?.language) ? { language: text(raw?.language) } : {}) } : undefined
}

/** A pack written by `agentic-search scan`, as the review reads it. Pure: it never throws and never reads a file. */
export function readPack(pack: unknown): Scan {
  const root = record(pack) ?? {}
  const tally = new Tally()

  const files = each(root.files, 'file', tally, fileOf)
  const fileLanguage = new Map(files.flatMap((file) => (file.language ? [[file.path, file.language] as const] : [])))
  const nodeLanguage = new Map(items(root.nodes).flatMap((item) => {
    const raw = record(item)
    const id = name(raw?.id)
    const language = text(raw?.language)
    return id && language ? [[id, language] as const] : []
  }))
  const languageOf = (id: string, path: string) => nodeLanguage.get(id) ?? fileLanguage.get(path)

  const nodes: Scan['nodes'] = {}
  for (const node of each(root.nodes, 'node', tally, nodeOf)) nodes[node.id] = node
  const anchors = each(root.anchors, 'anchor', tally, (item) => anchorOf(item, languageOf, tally))
  for (const { id, symbol, kind, path, startLine, endLine, entry } of anchors) nodes[id] ??= { id, symbol, kind, path, startLine, endLine, ...(entry ? { entry } : {}) }

  const edges = each(root.edges, 'edge', tally, edgeOf)
  const dangling = each(root.dangling, 'dangling entry', tally, danglingOf).filter((item): item is Dangling => item !== null)
  const tests = each(root.testGroups, 'test group', tally, (item) => testGroupOf(item, tally))
  // Absent unless the scan was asked for every test: no list is not the same as a list of none.
  const testDefinitions = Array.isArray(root.testDefinitions) ? each(root.testDefinitions, 'test definition', tally, testDefinitionOf) : undefined

  const coverage = record(root.coverage)
  const truncatedBy = text(coverage?.truncatedBy) ?? 'unknown'
  const skippedAnchors = items(root.skippedAnchors).length + tally.get('anchor')
  const unresolved = Number.isInteger(coverage?.unresolved) ? (coverage!.unresolved as number) : edges.filter((edge) => edge.resolution === 'unresolved').length
  const notes = items(coverage?.notes).filter((note): note is string => typeof note === 'string')
  if (!coverage) notes.push('The pack reported no coverage, so it may not be complete.')
  if (root.dirty === true) notes.push('The scan read a checkout with uncommitted changes.')
  const leftOut = tally.note()
  if (leftOut) notes.push(leftOut)

  return {
    anchors,
    nodes,
    edges,
    dangling,
    tests,
    ...(testDefinitions ? { testDefinitions } : {}),
    files: files.map(({ path, kind, status, language }) => ({ path, kind, status, ...(language ? { language } : {}) })),
    coverage: {
      truncated: truncatedBy !== 'none' || skippedAnchors > 0 || tally.get('dangling entry') > 0,
      truncatedBy,
      skippedAnchors,
      unresolved,
      notes,
    },
  }
}

// ───────────────────────── Running the scan ─────────────────────────

export const SCAN_TIMEOUT_MS = 120_000

/** Where agentic-search is found when PATH does not have it, as for an app opened from the Finder: pnpm's and Homebrew's folders. */
const PLACES = [join(homedir(), 'Library', 'pnpm', 'bin'), join(homedir(), 'Library', 'pnpm'), join(homedir(), '.local', 'share', 'pnpm'), '/opt/homebrew/bin', '/usr/local/bin']

/** The agentic-search program: the first executable file named so on PATH, then in the usual install folders. */
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

export type ScanOutcome = { ok: true; scan: Scan } | { ok: false; reason: string }

export interface ScanRequest {
  cwd: string
  base: string
  head: string
  /** The agentic-search program; found on PATH and in the usual folders when not given. */
  program?: string
  timeoutMs?: number
  maxAnchors?: number
  maxNodes?: number
  /** Call hops around each changed definition. */
  depth?: number
  /** List every call site of each changed definition, so a caller list can be complete. On unless set to `false`. */
  allCallers?: boolean
  /** List every test that references a changed definition, changed or not, in `testDefinitions`. On unless set to `false`. */
  allTests?: boolean
  signal?: AbortSignal
}

const option = (flagName: string, value: number | undefined) => (value === undefined ? [] : [flagName, String(value)])

/** Options newer releases of agentic-search take, each with a value, that an older one refuses: every caller, every test. */
const NEWER_OPTIONS = ['--callers', '--tests']

/**
 * The same arguments without the one newer option agentic-search refused by name, so the scan runs once more with the
 * tool's own limits there. Null for any other refusal, which stops the scan with what the tool said.
 */
export function withoutRefusedOption(args: readonly string[], reason: string): string[] | null {
  const refused = /unknown option '(--[\w-]+)'/i.exec(reason)?.[1]
  const at = refused && NEWER_OPTIONS.includes(refused) ? args.indexOf(refused) : -1
  return at < 0 ? null : [...args.slice(0, at), ...args.slice(at + 2)]
}

/**
 * Scans the change from `base` to `head` in the checkout at `cwd`. The pack holds source, so it is written to a
 * folder of its own, read, and removed. A scan that cannot run answers why, never a partial scan.
 */
export function runScan({ cwd, base, head, program, timeoutMs = SCAN_TIMEOUT_MS, maxAnchors, maxNodes, depth, allCallers = true, allTests = true, signal }: ScanRequest): Promise<ScanOutcome> {
  return scanOf(['--diff', `${base}..${head}`], { cwd, program, timeoutMs, maxAnchors, maxNodes, depth, allCallers, allTests, signal })
}

export interface AnchorScanRequest {
  cwd: string
  /** The places to scan, each `path:line`: the definition that holds the line is the anchor. */
  anchors: readonly string[]
  program?: string
  timeoutMs?: number
  signal?: AbortSignal
}

/**
 * Scans the definitions that hold the given places, one call deep, with every call site of each: who calls them, and
 * whether each is where a request enters. The same question the diff scan answers for a changed definition, asked of
 * one that did not change, so the way from a change up to its entry points can be followed a caller at a time.
 */
export function scanAnchors({ cwd, anchors, program, timeoutMs = SCAN_TIMEOUT_MS, signal }: AnchorScanRequest): Promise<ScanOutcome> {
  return scanOf(anchors.flatMap((anchor) => ['--anchor', anchor]), { cwd, program, timeoutMs, maxAnchors: anchors.length, depth: 1, allCallers: true, signal })
}

async function scanOf(target: string[], { cwd, program, timeoutMs = SCAN_TIMEOUT_MS, maxAnchors, maxNodes, depth, allCallers, allTests, signal }: Omit<ScanRequest, 'base' | 'head'>): Promise<ScanOutcome> {
  const file = program ?? findAgenticSearch()
  if (!file) return { ok: false, reason: 'agentic-search is not installed.' }
  const folder = mkdtempSync(join(tmpdir(), 'change-review-scan-'))
  try {
    const out = join(folder, 'pack')
    let args = [
      'scan',
      ...target,
      '--cwd',
      cwd,
      '--json',
      '--output-dir',
      out,
      ...(allCallers ? ['--callers', 'all'] : []),
      ...(allTests ? ['--tests', 'all'] : []),
      ...option('--max-anchors', maxAnchors),
      ...option('--max-nodes', maxNodes),
      ...option('--max-depth', depth),
    ]
    // The pack on disk is what is read; the same report on stdout is not needed.
    const scanned = () => runProgram(file, args, { cwd, env: { ...process.env, NO_COLOR: '1' }, timeoutMs, group: true, ignoreStdout: true, signal })
    let run = await scanned()
    for (;;) {
      if (!run.started) return { ok: false, reason: `agentic-search could not start: ${run.reason}` }
      if (run.timedOut) return { ok: false, reason: `the scan took longer than ${timeoutMs / 1000} seconds.` }
      if (run.aborted) return { ok: false, reason: 'the scan was stopped.' }
      if (run.code === 0) break
      const said = run.stderr.toString('utf8').trim().split('\n')[0]?.replace(/^agentic-search:\s*/, '')
      // An older agentic-search refuses a newer option by name: it runs once more without that one.
      const fewer = said ? withoutRefusedOption(args, said) : null
      if (!fewer) return { ok: false, reason: said || `the scan stopped with code ${run.code}.` }
      args = fewer
      run = await scanned()
    }
    let pack: unknown
    try {
      pack = JSON.parse(readFileSync(join(out, 'pack.json'), 'utf8'))
    } catch {
      return { ok: false, reason: 'the scan wrote no readable pack.json.' }
    }
    return { ok: true, scan: readPack(pack) }
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}
