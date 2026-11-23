/**
 * The vicinity of a change, from agentic-search: the request's life cycle around it, mapped by static call-graph
 * scans. The first scans the change at its commits. It reads the changed files at head; callers and the files the
 * change left alone it reads in the project's folder. Each scan after it starts from the callers found so far, given
 * as places in that folder, so the life cycle goes out a call at a time until it reaches where a request enters or
 * goes past the hops it may take. A view template that calls a helper is a caller, and what renders a template is its
 * caller; a controller action's routes, and Rails's exceptions app when it names the action, are where requests come
 * in, one step before it. Only calls the type checker or an index proved are kept as they are; a caller matched by
 * name alone is kept only where the scan has nothing better, and says so. Of the ways out from each changed
 * definition, the few nearest where a request enters are kept, and the review says how far the scans looked. What
 * the changed lines call is kept too, a few for each definition, the most telling first. Nothing here is shown as it
 * is: the review finds every definition again at head and checks every call there (`shared/review/vicinity.ts`). A
 * scan that cannot run leaves a notice and nothing else, so a review is never held up by it.
 */
import { execFile, spawn } from 'node:child_process'
import { accessSync, constants, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import { splitLines } from '#shared/review/lines.ts'
import { fileRole, isTestPath } from '#shared/review/paths.ts'
import { isSafePath } from '#shared/review/prose.ts'
import type { ReviewEntry } from '#shared/review/types.ts'
import { blockAt, functionOwners } from '#shared/review/units.ts'
import { LIFE_CYCLE, type Vicinity, type VicinityDefinition, type VicinityGuard, type VicinityLeft, type VicinityLink, type VicinityReach, type VicinityTest } from '#shared/review/vicinity.ts'
import { withoutRefusedOption } from '../../../packages/change-review/src/scan.ts'
import { gitReader } from './git.ts'

const exec = promisify(execFile)

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

/**
 * Where requests come in, one step before the code they reach, as the scan read it: a route or `config.exceptions_app`
 * naming a controller action; a command, a module Pi loads, or a name the package exports, as its package.json says.
 * `text` is the first line as written, for finding it again at head.
 */
interface Door {
  kind: string
  title: string
  file: string
  line: number
  endLine: number
  text?: string
  route?: { verbs: string[]; path: string }
}

/** What a package exposes is a door of its own; the definition behind it is no entry by itself. */
const PACKAGE_DOORS = new Set(['command', 'extension', 'export'])

interface Definition extends VicinityDefinition {
  id: string
  kind: string
  language: string
  entry?: ReviewEntry
  doors?: Door[]
}

interface Caller {
  id: string
  line: number
  proven: boolean
  guards: VicinityGuard[]
  enqueues: boolean
  changed: boolean
  boundary: boolean
  /** What the line writes when it is not the definition's own name: the path a render call names a template by. */
  name?: string
  /** Rails renders the action's own template by convention, so there is no call at the line to find. */
  convention: boolean
}

interface Anchor extends Definition {
  changedLines: number[]
  callers: Caller[]
  /** How many production call sites the scan found, and whether it listed them all. */
  count: { total: number; complete: boolean }
  /** How many of the call sites it listed are in tests. */
  testCallers: number
  /** The tests that use it, changed or not, by the scan's id for each when it gives one. */
  tests: { id?: string; path: string; symbol: string; line: number }[]
}

/** A test that references changed definitions, as the scan's `testDefinitions` list it with `--tests all`. */
interface TestDefinition {
  id: string
  path: string
  symbol: string
  /** The changed definitions it references, each with the first line that does. */
  anchors: { id: string; line: number }[]
  /** The diff touches the test itself. */
  changed: boolean
}

interface Edge {
  from: string
  to: string
  name: string
  relationship: string
  proven: boolean
  byName: boolean
  /** How the scan resolved it: `name_only` is a match of the name anywhere under the root. */
  via?: string
  line: number
  guards: VicinityGuard[]
}

interface Pack {
  nodes: Map<string, Definition>
  anchors: Anchor[]
  edges: Edge[]
  files: Set<string>
  testDefinitions: TestDefinition[]
  stopped: string | null
}

type Raw = Record<string, unknown>
const record = (value: unknown): Raw | undefined => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : undefined)
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)
const line = (value: unknown): number | undefined => (Number.isInteger(value) && (value as number) > 0 ? (value as number) : undefined)
const VERB = /^[A-Z]{3,7}$/

/** The routes that reach an action, and the config line that names it Rails's exceptions app, as the scan's entry says. */
function doorsOf(entry: Raw | undefined): Door[] {
  const routes = list(entry?.routes).flatMap((item): Door[] => {
    const route = record(item)
    const [path, file, at, said] = [text(route?.path), text(route?.file), line(route?.line), text(route?.text)]
    const verbs = list(route?.verbs).filter((verb): verb is string => typeof verb === 'string' && VERB.test(verb))
    return path?.startsWith('/') && file && isSafePath(file) && at && verbs.length ? [{ kind: 'route', title: `${verbs.join('/')} ${path}`, file, line: at, endLine: at, ...(said ? { text: said } : {}), route: { verbs, path } }] : []
  })
  const app = record(entry?.exceptionsApp)
  const [file, at, end, said] = [text(app?.file), line(app?.line), line(app?.endLine), text(app?.text)]
  const exceptions: Door[] = file && isSafePath(file) && at && end && end >= at ? [{ kind: 'exceptions-app', title: 'config.exceptions_app', file, line: at, endLine: end, ...(said ? { text: said } : {}) }] : []
  const exposed = list(entry?.doors).flatMap((item): Door[] => {
    const door = record(item)
    const [kind, title, where, at, said] = [text(door?.kind), text(door?.title), text(door?.file), line(door?.line), text(door?.text)]
    return kind && PACKAGE_DOORS.has(kind) && title && where && isSafePath(where) && at ? [{ kind, title, file: where, line: at, endLine: at, ...(said ? { text: said } : {}) }] : []
  })
  return [...routes, ...exceptions, ...exposed]
}

function definitionOf(value: unknown): Definition | undefined {
  const raw = record(value)
  const [id, path, symbol, startLine, endLine] = [text(raw?.id), text(raw?.path), text(raw?.symbol), line(raw?.startLine), line(raw?.endLine)]
  if (!raw || !id || !path || !symbol || !startLine || !endLine || endLine < startLine) return undefined
  const entry = record(raw.entry)
  const doors = doorsOf(entry)
  return {
    id, path, symbol, startLine, endLine, kind: text(raw.kind) ?? '', language: text(raw.language) ?? '',
    // What a package.json exposes comes in by its doors; a script's statement is where work starts by itself.
    ...(entry && text(entry.kind) && !(PACKAGE_DOORS.has(text(entry.kind)!) && list(entry.doors).length > 0) ? { entry: { kind: text(entry.kind)!, exact: entry.exact === true } } : {}),
    ...(doors.length ? { doors } : {}),
  }
}

const BRANCHES = new Set(['then', 'else', 'after-return'])
const guardsOf = (value: unknown): VicinityGuard[] =>
  list(value).flatMap((item) => {
    const raw = record(item)
    const [at, said, branch] = [line(raw?.line), text(raw?.text), text(raw?.branch)]
    return at && said && branch && BRANCHES.has(branch) ? [{ line: at, text: said, branch: branch as VicinityGuard['branch'] }] : []
  })

function testDefinitionOf(value: unknown): TestDefinition[] {
  const test = record(value)
  const [id, path, symbol] = [text(test?.id), text(test?.path), text(test?.symbol)]
  if (!test || !id || !path || !symbol || !isSafePath(path)) return []
  const anchors = list(test.anchors).flatMap((entry) => {
    const anchor = record(entry)
    const anchorId = text(anchor?.id)
    const first = list(anchor?.lines).map(line).find((at) => at != null)
    return anchorId && first ? [{ id: anchorId, line: first }] : []
  })
  return [{ id, path, symbol, anchors, changed: test.changed === true }]
}

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
    let testCallers = 0
    const callers = list(anchor.callers).flatMap((entry): Caller[] => {
      const site = record(entry)
      const [id, at, name] = [text(site?.id), line(site?.line), text(site?.name)]
      if (!site || !id || !at) return []
      // A test is never a way in, but that tests call it is worth saying.
      if (site.test === true) {
        testCallers += 1
        return []
      }
      return [{
        id, line: at, proven: site.resolution === 'exact', guards: guardsOf(site.guards), enqueues: site.enqueue === true, changed: site.changed === true, boundary: list(site.boundary).length > 0,
        ...(name ? { name } : {}), convention: site.convention === true,
      }]
    })
    const known = nodes.get(definition.id)
    return [{
      ...definition,
      language: definition.language || known?.language || '',
      ...(definition.entry ?? known?.entry ? { entry: definition.entry ?? known?.entry } : {}),
      ...(definition.doors ?? known?.doors ? { doors: definition.doors ?? known?.doors } : {}),
      changedLines: list(anchor.changedLines).flatMap((at) => (line(at) ? [at as number] : [])),
      callers,
      count: { total: Number.isInteger(counted?.total) ? (counted!.total as number) : callers.length, complete: counted?.complete === true },
      testCallers,
      tests: list(anchor.tests).flatMap((entry) => {
        const test = record(entry)
        const [id, path, symbol, at] = [text(test?.id), text(test?.path), text(test?.symbol), line(test?.line)]
        return path && symbol && at && isSafePath(path) ? [{ ...(id ? { id } : {}), path, symbol, line: at }] : []
      }),
    }]
  })
  const edges = list(raw.edges).flatMap((item): Edge[] => {
    const edge = record(item)
    const [from, to, at, relationship] = [text(edge?.from), text(edge?.to), line(edge?.line), text(edge?.relationship)]
    if (!edge || !from || !to || !at || !relationship) return []
    return [{ from, to, name: text(edge.name) ?? '', relationship, proven: edge.resolution === 'exact', byName: edge.resolution === 'static_candidate', ...(text(edge.via) ? { via: text(edge.via) } : {}), line: at, guards: guardsOf(edge.guards) }]
  })
  const files = new Set(list(raw.files).flatMap((item) => (text(record(item)?.path) ? [text(record(item)?.path)!] : [])))
  const testDefinitions = list(raw.testDefinitions).flatMap(testDefinitionOf)
  const truncated = record(raw.coverage)?.truncatedBy
  return { nodes, anchors, edges, files, testDefinitions, stopped: typeof truncated === 'string' && truncated !== 'none' ? truncated : null }
}

// ───────────────────────── Choosing the life cycle ─────────────────────────

/** A caller is kept as proven, or, where only an index could prove it and none did (Ruby), by a name rare enough to trust. */
const RARE_NAME = 3
/** What runs as its file loads, so a request's way through the code starts there. */
const LOADS = new Set(['statement'])
/** A type is no code that runs. */
const TYPES = new Set(['type', 'interface'])
/** What holds definitions rather than runs. */
const CONTAINERS = new Set(['class', 'module'])
/** A Ruby call on a local, an instance variable or another call's result: matched by name alone, it is a guess (`text.scan`). */
const LOCAL_RECEIVER = /^[a-z_@][\w@]*[.&]/

const declaredName = (symbol: string) => symbol.split(/::|[.#]/).at(-1) ?? symbol
const placeOf = (definition: VicinityDefinition) => `${definition.path}:${definition.startLine}`
const entryOf = (definition: Definition): ReviewEntry | undefined => definition.entry ?? (LOADS.has(definition.kind) ? { kind: 'load', exact: true } : undefined)
/** Where a request enters, so nothing further out is looked for; past a job, what enqueues it still is. */
const stopsAt = (entry: ReviewEntry | undefined) => entry != null && entry.kind !== 'job'
/** Nothing further out is looked for past where a request enters, or past what its package exposes. */
const stopsBefore = (definition: Definition) => stopsAt(entryOf(definition)) || (definition.doors?.length ?? 0) > 0
const bare = (definition: VicinityDefinition): VicinityDefinition => ({ path: definition.path, symbol: definition.symbol, startLine: definition.startLine, endLine: definition.endLine })

/** A link with where it sits in the life cycle: the changed definition it hangs off, and the places of its two ends. */
interface Ranked {
  link: VicinityLink
  /** The changed definition it hangs off, in the scan's order. */
  root: number
  /** The place it starts from, nearer the change, and the one it reaches: `path:line`, or a door's. */
  from: string
  to: string
}

/** A caller found, whose own callers a scan further out may look for. */
interface Frontier {
  definition: Definition
  root: number
  /** On the way out by the best caller at each call, so it is looked into first. */
  best: boolean
  /** The first scan read it at head, in a changed file, so the project's folder may have it on another line. */
  atHead: boolean
}

/** A changed definition the life cycle starts from. */
interface Root {
  place: string
  changed: { path: string; line: number }
  symbol: string
  /** The call sites outside tests the scan counted, and those in tests. */
  callers: number
  testCallers: number
}

interface Cycle {
  roots: Root[]
  callers: Ranked[]
  callees: Ranked[]
  frontier: Frontier[]
  /** Every caller already found, by place, so the life cycle never looks for one twice. */
  seen: Set<string>
  /** The actions whose doors are already linked, by place. */
  doors: Set<string>
  /** The changed definitions whose ways out the scans left unfollowed, and why. */
  stopped: Map<number, 'limit' | 'time'>
  left: Required<VicinityLeft>
}

/** The callers of one definition worth showing, best first: where a request enters, the change itself, proven, rendered by convention, a boundary, another file. */
function callersOf(anchor: Anchor, nodes: Map<string, Definition>, left: Required<VicinityLeft>): { caller: Caller; definition: Definition }[] {
  const usable = anchor.callers.flatMap((caller) => {
    const definition = nodes.get(caller.id)
    if (!definition || caller.id === anchor.id || isTestPath(definition.path)) return []
    // The type checker sees every call in JavaScript and TypeScript, so a caller it did not prove is another function of that name.
    const trusted = caller.proven || (anchor.language === 'ruby' && anchor.count.total <= RARE_NAME)
    if (!trusted) {
      left.byName += 1
      return []
    }
    return [{ caller, definition }]
  })
  if (!anchor.count.complete) left.partial += 1
  const score = ({ caller, definition }: (typeof usable)[number]) => [entryOf(definition) ? 0 : 1, caller.changed ? 0 : 1, caller.proven ? 0 : 1, caller.convention ? 0 : 1, caller.boundary ? 0 : 1, definition.path === anchor.path ? 1 : 0]
  const sorted = usable.sort((a, b) => {
    const [x, y] = [score(a), score(b)]
    return x.reduce((order, value, index) => order || value - y[index]!, 0) || a.definition.path.localeCompare(b.definition.path) || a.caller.line - b.caller.line
  })
  left.perDefinition += Math.max(0, sorted.length - LIFE_CYCLE.callers)
  return sorted.slice(0, LIFE_CYCLE.callers)
}

/** Links where requests come in to an action, one step before it: its routes, a few, and Rails's exceptions app. */
function addDoors(cycle: Cycle, action: Definition, from: { near: VicinityLink['near']; place: string; hops: number; root: number }) {
  if (!action.doors?.length || cycle.doors.has(from.place)) return
  cycle.doors.add(from.place)
  // A few of each kind: an action may have many routes, an export several names.
  const kept = action.doors.filter((door, index) => action.doors!.slice(0, index).filter((other) => other.kind === door.kind).length < LIFE_CYCLE.routes)
  cycle.left.perDefinition += action.doors.length - kept.length
  for (const door of kept) {
    const link: VicinityLink = {
      near: from.near,
      other: { path: door.file, symbol: door.title, startLine: door.line, endLine: door.endLine },
      direction: 'caller',
      hops: from.hops,
      call: { line: door.line, name: action.symbol, routes: door.text ?? '' },
      proven: true,
      entry: { kind: door.kind, exact: true, ...(door.route ? { route: door.route } : {}) },
    }
    cycle.callers.push({ link, root: from.root, from: from.place, to: `door:${door.file}:${door.line}` })
  }
}

/** Adds the callers of a definition, as links one call further out, and puts them on the frontier. */
function addCallers(cycle: Cycle, anchor: Anchor, nodes: Map<string, Definition>, from: { near: VicinityLink['near']; place: string; hops: number; root: number; best: boolean; changedFiles: Set<string> }) {
  callersOf(anchor, nodes, cycle.left).forEach(({ caller, definition }, index) => {
    const best = from.best && index === 0
    const entry = entryOf(definition)
    const link: VicinityLink = {
      near: from.near,
      other: bare(definition),
      direction: 'caller',
      hops: from.hops,
      call: {
        line: caller.line,
        name: caller.name ?? declaredName(anchor.symbol),
        ...(caller.guards.length ? { guards: caller.guards } : {}),
        ...(caller.enqueues ? { enqueues: true } : {}),
        // What calls a view template renders it.
        ...(anchor.kind === 'template' ? { renders: caller.convention ? ('convention' as const) : true } : {}),
      },
      proven: caller.proven,
      ...(entry ? { entry } : {}),
    }
    cycle.callers.push({ link, root: from.root, from: from.place, to: placeOf(definition) })
    addDoors(cycle, definition, { near: { definition: bare(definition) }, place: placeOf(definition), hops: from.hops + 1, root: from.root })
    // Where a request enters, nothing further out is looked for, and a changed caller's callers are the change's own.
    // A caller already found is looked into once.
    if (stopsBefore(definition) || caller.changed || cycle.seen.has(placeOf(definition))) return
    cycle.seen.add(placeOf(definition))
    cycle.frontier.push({ definition, root: from.root, best, atHead: from.hops === 1 && from.changedFiles.has(definition.path) })
  })
}

/** The first call out from each changed definition: its callers, its doors, and what its changed lines call. */
function firstCalls(pack: Pack): Cycle & { entries: NonNullable<Vicinity['entries']> } {
  const cycle: Cycle = { roots: [], callers: [], callees: [], frontier: [], seen: new Set(), doors: new Set(), stopped: new Map(), left: { byName: 0, perDefinition: 0, further: 0, partial: 0, aside: 0 } }
  const entries: NonNullable<Vicinity['entries']> = []
  const changedIds = new Set(pack.anchors.map((anchor) => anchor.id))
  const roots = pack.anchors.filter((anchor) => !isTestPath(anchor.path) && anchor.changedLines.length > 0)
  // A changed action's doors are its own, so they are linked before another changed definition reaches it as a caller.
  roots.forEach((anchor, root) => {
    const changed = { path: anchor.path, line: anchor.changedLines[0]! }
    cycle.roots.push({ place: placeOf(anchor), changed, symbol: anchor.symbol, callers: anchor.count.total, testCallers: anchor.testCallers })
    if (anchor.entry) entries.push({ changed, entry: anchor.entry })
    addDoors(cycle, anchor, { near: { changed }, place: placeOf(anchor), hops: 1, root })
  })
  roots.forEach((anchor, root) => {
    const changed = { path: anchor.path, line: anchor.changedLines[0]! }
    addCallers(cycle, anchor, pack.nodes, { near: { changed }, place: placeOf(anchor), hops: 1, root, best: true, changedFiles: pack.files })

    const callees = new Map<string, { edge: Edge; definition: Definition }>()
    for (const edge of pack.edges) {
      if (edge.from !== anchor.id || !anchor.changedLines.includes(edge.line) || (edge.relationship !== 'calls' && edge.relationship !== 'enqueues')) continue
      const definition = pack.nodes.get(edge.to)
      if (!definition || changedIds.has(definition.id) || callees.has(definition.id) || TYPES.has(definition.kind) || isTestPath(definition.path)) continue
      if (!edge.proven && !(edge.byName && anchor.language === 'ruby')) continue
      // `format.html` is not SignatureValidator#html: a call on a local, matched by its name alone, goes nowhere known.
      if (!edge.proven && edge.via === 'name_only' && LOCAL_RECEIVER.test(edge.name)) continue
      // A Ruby call the scan could only tie to a class or a module names no method of it.
      if (!edge.proven && anchor.language === 'ruby' && CONTAINERS.has(definition.kind)) continue
      callees.set(definition.id, { edge, definition })
    }
    const sorted = [...callees.values()].sort(
      (a, b) => Number(b.edge.relationship === 'enqueues') - Number(a.edge.relationship === 'enqueues') || Number(a.definition.path === anchor.path) - Number(b.definition.path === anchor.path) || a.edge.line - b.edge.line,
    )
    cycle.left.perDefinition += Math.max(0, sorted.length - LIFE_CYCLE.callees)
    for (const { edge, definition } of sorted.slice(0, LIFE_CYCLE.callees)) {
      const link: VicinityLink = {
        near: { changed: { path: anchor.path, line: edge.line } },
        other: bare(definition),
        direction: 'callee',
        hops: 1,
        call: { line: edge.line, name: declaredName(definition.symbol), ...(edge.guards.length ? { guards: edge.guards } : {}), ...(edge.relationship === 'enqueues' ? { enqueues: true } : {}) },
        proven: edge.proven,
      }
      cycle.callees.push({ link, root, from: placeOf(anchor), to: placeOf(definition) })
    }
  })
  return { ...cycle, entries }
}

/** What is used by name rather than called: a constant, a schema, a type. The scan lists calls only, so it finds no caller for these. */
const USED_BY_NAME = new Set(['constant', 'variable', 'type', 'interface', 'enum', 'class', 'declaration'])
/** The most places one changed constant or type is looked for. */
const MOST_REFERENCES = 12

/**
 * Where a use of a name can count: the file that defines it, and whether other files may import it. Ruby files never
 * import a constant by its name, so for a Ruby definition only its own file can hold a use that counts.
 */
export interface ReferenceScope {
  file: string
  importers: boolean
}

/** Where a name is used at head, as git finds the whole word in the commit, never in the working tree. */
export type ReferenceSearch = (name: string, scope: ReferenceScope) => Promise<{ path: string; line: number }[]>

/** The definition at head that holds a line: the innermost declaration around it, else the statement that starts there. */
function enclosingAt(text: string, at: number, path: string): VicinityDefinition | null {
  const source = splitLines(text)
  const { owners, spans } = functionOwners(source)
  const owner = owners[at - 1]
  const span = owner ? spans.get(owner) : undefined
  if (owner && span) return { path, symbol: owner.split('\u001f')[0]!, startLine: span[0] + 1, endLine: span[1] + 1 }
  const block = blockAt(text, at)
  const first = source[at - 1]?.trim()
  return block && first ? { path, symbol: first.slice(0, 80), startLine: block.startLine, endLine: block.endLine } : null
}

/**
 * The places that use a changed constant, schema or type, as callers one call away: its own file, where its name can
 * only mean it, and the code files that import it by that name, in an import statement of their own. A place in a
 * test, in a file that holds no code (a lockfile, a document), or in the definition itself, is not one.
 */
async function referencesOf(anchor: Anchor, search: ReferenceSearch, readHead: (path: string) => Promise<string | null>): Promise<{ definition: VicinityDefinition; line: number; proven: boolean }[]> {
  const name = declaredName(anchor.symbol)
  if (!/^[\w$]+$/.test(name)) return []
  const found: { definition: VicinityDefinition; line: number; proven: boolean }[] = []
  const seen = new Set<string>()
  for (const hit of await search(name, { file: anchor.path, importers: anchor.language !== 'ruby' })) {
    if (found.length >= MOST_REFERENCES) break
    if (isTestPath(hit.path) || (hit.path === anchor.path && hit.line >= anchor.startLine && hit.line <= anchor.endLine)) continue
    const text = await readHead(hit.path)
    if (text == null || fileRole(hit.path, text.split('\n', 1)[0]) !== 'code') continue
    const definition = enclosingAt(text, hit.line, hit.path)
    if (!definition || seen.has(placeOf(definition))) continue
    // In another file the name means this one only when that file imports it.
    const imported = hit.path === anchor.path || new RegExp(`^\\s*import\\s[^;\\n]*\\b${name}\\b`, 'm').test(text)
    if (!imported) continue
    seen.add(placeOf(definition))
    found.push({ definition, line: hit.line, proven: hit.path === anchor.path })
  }
  return found
}

/** A file in a folder that makes it a project of its own, as the call-graph scan finds a project's root. */
const isProjectFile = (name: string) => name === 'package.json' || name === 'component.yml' || name === 'Gemfile' || name.endsWith('.gemspec')
/** The files that may import a JavaScript or TypeScript definition. */
const IMPORTER_EXTENSIONS = ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte', 'astro']
const GIT_READ_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0' }

/**
 * The project a file sits in at head: the deepest folder above it that holds a package.json, component.yml, Gemfile
 * or gemspec, read in one listing of every such folder. The empty string is the whole repository.
 */
async function projectOf(repo: string, head: string, file: string): Promise<string> {
  const parts = file.split('/').slice(0, -1)
  const folders = parts.map((_, index) => parts.slice(0, index + 1).join('/'))
  let stdout: string
  try {
    ;({ stdout } = await exec('git', ['-C', repo, 'ls-tree', '-z', '--full-name', '--name-only', head, '--', './', ...folders.map((folder) => `${folder}/`)], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: SCAN_TIMEOUT_MS, env: { ...GIT_READ_ENV, GIT_LITERAL_PATHSPECS: '1' } }))
  } catch {
    return ''
  }
  const holding = new Set(stdout.split('\0').flatMap((entry) => {
    const at = entry.lastIndexOf('/')
    return isProjectFile(entry.slice(at + 1)) ? [at < 0 ? '' : entry.slice(0, at)] : []
  }))
  return folders.findLast((folder) => holding.has(folder)) ?? ''
}

/** git's pathspecs for where a use can count: the defining file as written, and the code of its project that may import it. */
async function referencePaths(repo: string, head: string, { file, importers }: ReferenceScope): Promise<string[]> {
  const own = `:(literal)${file}`
  if (!importers) return [own]
  // A folder's name is never read as a pattern.
  const under = (await projectOf(repo, head, file)).replace(/[*?[\]\\]/g, '\\$&')
  return [own, ...IMPORTER_EXTENSIONS.map((extension) => `:(glob)${under ? `${under}/` : ''}**/*.${extension}`)]
}

/**
 * Where git finds the whole word at a commit: the commit's own files, read without the working tree, and only those
 * where a use can count, so a very large repository is never read whole.
 */
export function gitReferences(repo: string, head: string): ReferenceSearch {
  return async (name, scope) => {
    let stdout: string
    try {
      const paths = await referencePaths(repo, head, scope)
      ;({ stdout } = await exec('git', ['-C', repo, 'grep', '-n', '-w', '-F', '-I', '-e', name, head, '--', ...paths], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: SCAN_TIMEOUT_MS, env: GIT_READ_ENV }))
    } catch {
      // No place at all, or none git could read.
      return []
    }
    return stdout.split('\n').flatMap((entry) => {
      const [, path, at] = /^[^:]+:([^:]+):(\d+):/.exec(entry) ?? []
      return path && at && isSafePath(path) ? [{ path, line: Number(at) }] : []
    })
  }
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

/** The most ways out one changed definition's search keeps open at once, so a wide fan of callers stays quick. */
const MOST_OPEN_WAYS = 400

const isDoor = (entry: ReviewEntry | undefined) => entry?.kind === 'route' || entry?.kind === 'exceptions-app'

/**
 * Every way out from a place, along the callers, each to where it ends: a door, an entry with no door, or a caller
 * nothing further calls. An action goes on to its doors only. A job is an end, and so is the way on through what
 * enqueues it. Breadth first, so a nearer end comes first.
 */
function waysFrom(start: string, out: ReadonlyMap<string, Ranked[]>): Ranked[][] {
  const done: Ranked[][] = []
  let open: Ranked[][] = (out.get(start) ?? []).map((ranked) => [ranked])
  while (open.length > 0) {
    const next: Ranked[][] = []
    const go = (way: Ranked[], ranked: Ranked) => next.length < MOST_OPEN_WAYS && next.push([...way, ranked])
    for (const way of open) {
      const last = way.at(-1)!
      const entry = last.link.entry
      if (isDoor(entry)) {
        done.push(way)
        continue
      }
      const onward = (out.get(last.to) ?? []).filter((ranked) => ranked.to !== start && !way.some((step) => step.from === ranked.to))
      if (stopsAt(entry)) {
        const doors = onward.filter((ranked) => isDoor(ranked.link.entry))
        if (doors.length === 0) done.push(way)
        for (const door of doors) go(way, door)
        continue
      }
      if (entry || onward.length === 0) done.push(way)
      for (const ranked of onward) go(way, ranked)
    }
    open = next
  }
  return done
}

/** How good a way in is: one that reaches where a request enters, the nearest first, a door or a declared entry before a guess; else the longest. */
function wayScore(way: Ranked[]): number[] {
  // A door is one step before the action it reaches, and that step is not a call.
  if (isDoor(way.at(-1)!.link.entry)) return [0, way.length - 1, 0]
  const at = way.findIndex((step) => step.link.entry)
  if (at < 0) return [1, -way.length, 0]
  return [0, at + 1, way[at]!.link.entry!.exact ? 1 : 2]
}

/**
 * The links the review shows, in the order it reads them: for each changed definition the best way in, then what the
 * changed lines call, then the next best ways, at most a few for each. Ways that share callers join where they meet.
 */
function chooseWays(cycle: Cycle): { links: VicinityLink[]; aside: number } {
  const out = new Map<string, Ranked[]>()
  for (const ranked of cycle.callers) out.set(ranked.from, [...(out.get(ranked.from) ?? []), ranked])
  const order = new Map(cycle.callers.map((ranked, index) => [ranked, index]))
  const chosen = cycle.roots.map((root) =>
    waysFrom(root.place, out)
      .map((way) => ({ way, score: wayScore(way) }))
      .sort((a, b) => a.score.reduce((by, value, index) => by || value - b.score[index]!, 0) || a.way.reduce((by, step, index) => by || order.get(step)! - (b.way[index] ? order.get(b.way[index]!)! : Infinity), 0))
      .slice(0, LIFE_CYCLE.ways)
      .map(({ way }) => way),
  )
  const kept = new Set<Ranked>()
  const links: VicinityLink[] = []
  const take = (way: Ranked[] | undefined) => {
    for (const step of way ?? []) {
      if (kept.has(step)) continue
      kept.add(step)
      links.push(step.link)
    }
  }
  chosen.forEach((ways) => take(ways[0]))
  for (const ranked of cycle.callees) links.push(ranked.link)
  for (let rank = 1; rank < LIFE_CYCLE.ways; rank += 1) chosen.forEach((ways) => take(ways[rank]))
  const shown = new Set([...kept].map((ranked) => ranked.to))
  const aside = new Set(cycle.callers.filter((ranked) => !shown.has(ranked.to) && !ranked.to.startsWith('door:')).map((ranked) => ranked.to)).size
  return { links, aside }
}

/** The life cycle's links in the order the review shows them, how far each changed definition's ways went, the tests that use the change, and what was left out. */
function finish(cycle: Cycle, entries: NonNullable<Vicinity['entries']>, notes: string[], tests: VicinityTest[]): Vicinity {
  const { links, aside } = chooseWays(cycle)
  cycle.left.aside = aside
  const reach: VicinityReach[] = cycle.roots.map((root, index) => {
    const hops = Math.max(0, ...cycle.callers.filter((ranked) => ranked.root === index && !ranked.to.startsWith('door:')).map((ranked) => ranked.link.hops))
    const stopped = cycle.stopped.get(index)
    // Tests that call it are counted beside the other call sites, so only tests calling it can be told.
    const called = root.testCallers > 0 ? { callers: root.callers, testCallers: root.testCallers } : {}
    return { changed: root.changed, symbol: root.symbol, hops, ...(stopped ? { stopped } : {}), ...called }
  })
  const notice = notes.join(' ')
  return { links, ...(tests.length ? { tests } : {}), ...(entries.length ? { entries } : {}), ...(reach.length ? { reach } : {}), ...(notice ? { notice } : {}), left: cycle.left }
}

/**
 * The tests the scan says use each changed definition, at the definition's first changed line: those it names by the
 * definition, then those its test definitions say reference it, each once. A test says whether the diff touched it when
 * the test definitions say so.
 */
function testsOf(pack: Pack): VicinityTest[] {
  const definitionOf = new Map(pack.testDefinitions.map((test) => [test.id, test]))
  return pack.anchors.flatMap((anchor) => {
    if (!anchor.changedLines.length) return []
    const changed = { path: anchor.path, line: anchor.changedLines[0]! }
    const named = anchor.tests.map(({ id, ...test }) => {
      const definition = id ? definitionOf.get(id) : undefined
      return definition ? { ...test, changed: definition.changed } : test
    })
    const namedIds = new Set(anchor.tests.flatMap((test) => (test.id ? [test.id] : [])))
    const isNamed = (test: TestDefinition) => namedIds.has(test.id) || named.some((entry) => entry.path === test.path && entry.symbol === test.symbol)
    const referencing = pack.testDefinitions.flatMap((test) => {
      const reference = test.anchors.find((entry) => entry.id === anchor.id)
      return reference && !isNamed(test) ? [{ path: test.path, symbol: test.symbol, line: reference.line, changed: test.changed }] : []
    })
    return [...named, ...referencing].map((test) => ({ changed, test }))
  })
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
  references = gitReferences(repo, head),
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
  /** Where a changed constant or type is used at head. */
  references?: ReferenceSearch
  now?: () => number
  budgetMs?: number
}): Promise<Vicinity> {
  const notShown = (why: string): Vicinity => ({ links: [], notice: `Callers and callees are not shown: ${why}` })
  const started = now()
  const remaining = () => budgetMs - (now() - started)
  const folder = mkdtempSync(join(tmpdir(), 'hobkin-review-scan-'))
  let packs = 0
  const scan = async (target: string[], limits: string[], timeoutMs: number): Promise<{ pack: Pack } | { reason: string }> => {
    let args = ['scan', ...target, '--cwd', repo, '--json', ...limits, '--output-dir', join(folder, `pack-${(packs += 1)}`)]
    let answer = await run(args, { timeoutMs })
    // An older agentic-search refuses a newer option by name: the scan runs once more without that one.
    for (let fewer = answer.ok ? null : withoutRefusedOption(args, answer.reason); fewer; fewer = answer.ok ? null : withoutRefusedOption(args, answer.reason)) {
      args = fewer
      answer = await run(args, { timeoutMs })
    }
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
    const first = await scan(['--diff', `${base}..${head}`], ['--max-depth', '1', '--max-anchors', '60', '--max-nodes', '120', '--budget-ms', '30000', '--tests', 'all'], SCAN_TIMEOUT_MS)
    if (!('pack' in first)) return notShown(first.reason)
    const cycle = firstCalls(first.pack)
    const notes = stoppedEarly(first.pack)
    /** Callers whose own callers are not looked for, counted, and why their changed definitions' ways stop there. */
    const unfollowed = (frontier: readonly Frontier[], why: 'limit' | 'time') => {
      cycle.left.further += frontier.length
      for (const item of frontier) if (!cycle.stopped.has(item.root)) cycle.stopped.set(item.root, why)
    }
    // A changed constant, schema or type has no calls to list: what uses it by name is its caller.
    const roots = first.pack.anchors.filter((entry) => !isTestPath(entry.path) && entry.changedLines.length > 0)
    // A Ruby declaration is a statement such as `require "json"`, which nothing uses by its name.
    for (const anchor of roots.filter((entry) => USED_BY_NAME.has(entry.kind) && entry.callers.length === 0 && !(entry.language === 'ruby' && entry.kind === 'declaration'))) {
      const root = roots.indexOf(anchor)
      const places = await referencesOf(anchor, references, readHead)
      // Found by name and checked again at head: the scan's own word that it could not list every caller goes.
      if (places.length > 0 && !anchor.count.complete) cycle.left.partial = Math.max(0, cycle.left.partial - 1)
      places.forEach(({ definition, line: at, proven }, index) => {
        const link: VicinityLink = { near: { changed: { path: anchor.path, line: anchor.changedLines[0]! } }, other: definition, direction: 'caller', hops: 1, call: { line: at, name: declaredName(anchor.symbol), reference: true }, proven }
        cycle.callers.push({ link, root, from: placeOf(anchor), to: placeOf(definition) })
        if (cycle.seen.has(placeOf(definition))) return
        cycle.seen.add(placeOf(definition))
        cycle.frontier.push({ definition: { ...definition, id: `ref:${placeOf(definition)}`, kind: 'function', language: anchor.language }, root, best: index === 0, atHead: true })
      })
    }

    for (let hop = 2; cycle.frontier.length > 0; hop += 1) {
      const wanted = cycle.frontier.sort((a, b) => Number(b.best) - Number(a.best) || a.root - b.root)
      cycle.frontier = []
      if (hop > LIFE_CYCLE.hops) {
        unfollowed(wanted, 'limit')
        break
      }
      const time = Math.min(SCAN_TIMEOUT_MS, remaining())
      if (time < LEAST_SCAN_MS) {
        unfollowed(wanted, 'time')
        notes.push(`The callers further out than ${hop - 1} call${hop - 1 === 1 ? '' : 's'} are not shown: the scans used the time they had.`)
        break
      }
      const starts: { from: Frontier; line: number }[] = []
      for (const from of wanted) {
        const at = from.atHead ? await lineInFolder(from.definition, readHead, readFolder) : from.definition.startLine
        if (at != null && starts.length < MOST_PER_SCAN) starts.push({ from, line: at })
        else unfollowed([from], 'limit')
      }
      if (starts.length === 0) break
      const next = await scan(starts.flatMap(({ from, line: at }) => ['--anchor', `${from.definition.path}:${at}`]), ['--max-depth', '1', '--max-anchors', String(starts.length), '--max-nodes', '60', '--budget-ms', '20000'], time)
      if (!('pack' in next)) {
        unfollowed(starts.map(({ from }) => from), 'time')
        notes.push(`The callers further out than ${hop - 1} call${hop - 1 === 1 ? '' : 's'} are not shown: ${next.reason}`)
        break
      }
      notes.push(...stoppedEarly(next.pack).filter((note) => !notes.includes(note)))
      for (const { from, line: at } of starts) {
        const anchor = next.pack.anchors.find((entry) => entry.path === from.definition.path && entry.startLine <= at && at <= entry.endLine)
        if (!anchor) continue
        const place = placeOf(from.definition)
        const near = { definition: bare(from.definition) }
        // Found by name where the scan had not looked yet, it turns out to be where a request enters: it says so now.
        if (!from.definition.entry && anchor.entry) for (const ranked of cycle.callers) if (ranked.to === place && !ranked.link.entry) ranked.link.entry = anchor.entry
        addDoors(cycle, anchor, { near, place, hops: hop, root: from.root })
        if (stopsBefore(anchor) && !stopsBefore(from.definition)) continue
        addCallers(cycle, anchor, next.pack.nodes, { near, place, hops: hop, root: from.root, best: from.best, changedFiles: first.pack.files })
      }
    }
    return finish(cycle, cycle.entries, notes, testsOf(first.pack))
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}
