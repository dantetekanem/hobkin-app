/**
 * The vicinity of a change: the request's life cycle around it, found by a static call-graph scan (agentic-search).
 * What calls the changed code, what calls that, and so on out to where a request enters, becomes context wired with
 * `called-by`; what the changed lines call becomes context wired with `calls`. A view template that calls a helper is
 * a caller, and so is what renders the template. Where a request enters, a route or the app Rails sends a failing
 * request to, is a node of its own one step before the controller action it reaches. The host runs the scan and hands
 * its links here as data, the most telling first. The host owns every code range: each definition is found again in
 * the file at head, and one that is not there, that no longer makes the call, or that the change itself touched, is
 * left out. Past the limit the rest are left out too, and the review says what was, and why. Each changed definition
 * then says, in a line, the way a request takes to it, or how far the scan looked without finding one.
 */
import type { Capture } from './capture.ts'
import { hashLines, splitLines } from './lines.ts'
import { cleanProse, count, isSafePath, listed } from './prose.ts'
import { HOST_TEXT_LIMIT, PROSE_LIMIT, TITLE_LIMIT, type EdgeKind, type ReviewEntry, type ReviewFile, type ReviewLifecycle, type ReviewNode } from './types.ts'
import { blockAt, declarationsOf } from './units.ts'

/** A definition, as 1-based first and last line in a file, where the scan read it. */
export interface VicinityDefinition {
  path: string
  symbol: string
  startLine: number
  endLine: number
}

/** A condition a call sits under, as written, with the branch the call is on (agentic-search's `Guard`). */
export interface VicinityGuard {
  line: number
  text: string
  /** `then`: inside the branch taken when the text holds. `else`: inside the other. `after-return`: past an early exit taken when it holds. */
  branch: 'then' | 'else' | 'after-return'
}

/** The call between the two ends of a link, as the scan read it. */
export interface VicinityCall {
  /** Its line in the caller. */
  line: number
  /** The name it calls: the callee's own name, or the path a render call names a template by. */
  name: string
  /** The conditions it sits under, outermost first. */
  guards?: VicinityGuard[]
  /** It only enqueues the callee, which runs later on its own (a job's perform). */
  enqueues?: boolean
  /** Not a call: the caller uses the changed constant, schema or type by name. */
  reference?: boolean
  /**
   * The caller renders the near end, a view template: by a render call on `line`, or by convention, with no call to
   * find (Rails renders an action's own template once the action is done).
   */
  renders?: true | 'convention'
  /** Not a call: the other end sends requests to the near end, a route or a config line, and this is its line as written. `name` is then the action's. */
  routes?: string
  /** The key of the property whose value holds the call, such as `review.prepare` in a map of handlers. */
  key?: string
}

export interface VicinityLink {
  /** The end nearer the change: a line inside a changed definition at head, or the caller nearer in, which this one calls. */
  near: { changed: { path: string; line: number } } | { definition: VicinityDefinition }
  /** The definition on the other end. */
  other: VicinityDefinition
  /** `callee`: the changed lines call it. `caller`: it calls the near end. */
  direction: 'callee' | 'caller'
  /** How many calls the other end is from the change: 1 for what the changed lines call and what calls the changed code. */
  hops: number
  call: VicinityCall
  /** The type checker or the index proved the call reaches the other end. Otherwise it was matched by name. */
  proven: boolean
  /** The other end is where a request enters. */
  entry?: ReviewEntry
  /** What the way in at the other end goes by, as the scan names it at this call: a handler's key, an event, an element and its prop. */
  named?: string
}

/** What the scan left out before the host looked at anything, by why. */
export interface VicinityLeft {
  /** Callers matched by name alone, which nothing proved. */
  byName?: number
  /** Callers and callees past the few kept for each definition. */
  perDefinition?: number
  /** Definitions whose callers go on past the last call followed. */
  further?: number
  /** Definitions whose callers the scan could not list in full: a name too common to search, or too many places. */
  partial?: number
  /** Callers on other ways out, past the few ways kept for each changed definition. */
  aside?: number
}

/** A test that uses a changed definition, as the scan found it: the changed line it reaches, and where the test is. */
export interface VicinityTest {
  changed: { path: string; line: number }
  /** `changed`: the diff touches the test itself, as the scan's test definitions say. Missing from an older scan. */
  test: { path: string; symbol: string; line: number; changed?: boolean }
}

/** How far the scans followed the callers of one changed definition, and why they went no further. */
export interface VicinityReach {
  changed: { path: string; line: number }
  /** Its name as the scan reads it, such as `ErrorsController#show`, for saying the way in. */
  symbol?: string
  /** The most calls out any way from it went. */
  hops: number
  /** `limit`: the calls the life cycle follows ran out; `time`: the scans could go no further, out of time or failing. Otherwise no caller was left. */
  stopped?: 'limit' | 'time'
  /** The call sites outside tests the scan counted, and those in tests, so "only tests call it" can be said. Missing from an older host. */
  callers?: number
  testCallers?: number
}

export interface Vicinity {
  links: VicinityLink[]
  /** Tests that use the changed definitions, changed or not. */
  tests?: VicinityTest[]
  /** Changed definitions where a request enters, as the scan says. */
  entries?: { changed: { path: string; line: number }; entry: ReviewEntry }[]
  /** How far out the scans went from each changed definition. */
  reach?: VicinityReach[]
  /** What the review should say about the scan itself: that it could not run, or stopped early. */
  notice?: string
  left?: VicinityLeft
}

/** The most unchanged definitions and routes a review shows around its change, so the graph stays readable. */
export const VICINITY_LIMIT = 24

/**
 * How far out the life cycle is followed, how many callers and callees are kept for each definition, best first, how
 * many ways out are kept for each changed definition, and how many routes for each controller action.
 */
export const LIFE_CYCLE = { hops: 6, callers: 3, callees: 3, ways: 3, routes: 3 } as const


export interface VicinityGraph {
  capture: Capture
  nodes: ReviewNode[]
  files: ReviewFile[]
  headFiles: Map<string, string>
  readHead(path: string): Promise<string | null>
  wire(kind: EdgeKind, from: string, to: string, label?: string): void
}

/** A definition found again at head: its file, its text, and the host's own range for it. */
interface Spot {
  path: string
  fileId: string
  text: string
  startLine: number
  endLine: number
}

const keyOf = (definition: VicinityDefinition) => `${definition.path}:${definition.startLine}:${definition.symbol}`
/** The name a definition is declared by: the last part of `Reviews.watch` or `Billing::Cart#total`. */
const declaredName = (symbol: string) => symbol.split(/::|[.#]/).at(-1) ?? symbol
const IDENTIFIER = /^[\w$]+[!?=]?$/
const ENTRY_KIND = /^[a-z][a-z-]{0,31}$/
const VERB = /^[A-Z]{3,7}$/
/** A Rails view template, which is one definition: the whole file. */
const TEMPLATE = /(?:^|\/)app\/views\/.+\.(?:erb|haml|slim|jbuilder|builder)$/
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const sameText = (text: string) => text.trim().replace(/\s+/g, ' ')

/**
 * Adds the life cycle's context nodes and their wires to a draft, in the order the links come, says on each changed
 * definition the way a request takes to it, and answers what the review should say about it.
 */
export async function addVicinity(vicinity: Vicinity, graph: VicinityGraph): Promise<string[]> {
  const { capture, nodes } = graph
  const fileByPath = new Map(capture.files.map((file) => [file.path, file]))
  const touches = (path: string, startLine: number, endLine: number) => {
    const file = fileByPath.get(path)
    return file != null && capture.changes.some((change) => change.fileId === file.id && change.side === 'added' && change.startLine <= endLine && startLine <= change.endLine)
  }
  /** The changed node that holds a line at head. */
  const holder = (path: string, line: number) => {
    const file = fileByPath.get(path)
    if (!file) return undefined
    return nodes.find((node) => node.kind === 'code' && node.anchors.some((anchor) => anchor.fileId === file.id && anchor.side === 'added' && anchor.startLine <= line && line <= anchor.endLine))
  }
  const read = new Map<string, Promise<string | null>>()
  const textOf = (path: string): Promise<string | null> => {
    const captured = fileByPath.get(path)
    if (captured) return Promise.resolve(captured.head)
    const known = graph.headFiles.get(path)
    if (known != null) return Promise.resolve(known)
    if (!read.has(path)) read.set(path, graph.readHead(path))
    return read.get(path)!
  }
  const spotIn = (path: string, text: string, startLine: number, endLine: number): Spot => ({ path, fileId: fileByPath.get(path)?.id ?? path, text, startLine, endLine })

  /**
   * The definition at head: by its name, nearest where the scan saw it; a statement by the words it starts with; a
   * view template as its whole file; and a route or a config line by the words of that line, as the scan read them.
   */
  const locate = async (definition: VicinityDefinition, line?: string): Promise<Spot | null> => {
    if (!isSafePath(definition.path) || !(definition.startLine >= 1 && definition.endLine >= definition.startLine)) return null
    const text = await textOf(definition.path)
    if (text == null) return null
    const source = splitLines(text)
    if (line != null) {
      const found = source.flatMap((entry, index) => (sameText(entry) === sameText(line) && sameText(line) ? [index + 1] : []))
      if (found.length === 0) return null
      const at = found.reduce((best, next) => (Math.abs(next - definition.startLine) < Math.abs(best - definition.startLine) ? next : best))
      return spotIn(definition.path, text, at, Math.min(source.length, at + (definition.endLine - definition.startLine)))
    }
    if (TEMPLATE.test(definition.path) && definition.startLine === 1) {
      const last = source.findLastIndex((entry) => entry.trim() !== '') + 1
      return last >= 1 ? spotIn(definition.path, text, 1, last) : null
    }
    const symbol = definition.symbol.trim().replace(/\s+/g, ' ')
    const name = declaredName(symbol)
    let found = IDENTIFIER.test(name) ? declarationsOf(text, name) : []
    if (found.length === 0 && symbol) {
      found = source.flatMap((entry, index) => (entry.trim().replace(/\s+/g, ' ').startsWith(symbol) ? [blockAt(text, index + 1)!] : []))
    }
    if (found.length === 0) return null
    const nearest = found.reduce((best, next) => (Math.abs(next.startLine - definition.startLine) < Math.abs(best.startLine - definition.startLine) ? next : best))
    return spotIn(definition.path, text, nearest.startLine, nearest.endLine)
  }

  /** The line of a call to `name` inside a range at head, nearest the one the scan saw, or null when there is none. */
  const callIn = (text: string, startLine: number, endLine: number, name: string, wanted: number): number | null => {
    const calls = new RegExp(`(^|[^\\w$])${escaped(name)}([^\\w$!?]|$)`)
    const source = splitLines(text)
    let best: number | null = null
    for (let line = startLine; line <= Math.min(endLine, source.length); line += 1) {
      if (calls.test(source[line - 1]!) && (best == null || Math.abs(line - wanted) < Math.abs(best - wanted))) best = line
    }
    return best
  }

  const reached = new Map<string, ReviewNode>()
  const placed = new Map<string, ReviewNode>()
  const left = new Map<string, 'missing' | 'limit'>()
  /** The called-by wires drawn, from the node nearer the change to the one further out. */
  const outward = new Map<string, string[]>()
  /** The nodes that are a door a request comes in by: a route, a config line, a line of package.json. */
  const doors = new Set<string>()
  /** What the way in at a node goes by, as the scan named it at the call: a handler's key, an event, an element and its prop. */
  const named = new Map<string, string>()
  let made = 0

  for (const link of vicinity.links) {
    const key = keyOf(link.other)
    const near = 'changed' in link.near ? holder(link.near.changed.path, link.near.changed.line) : reached.get(keyOf(link.near.definition))
    if (!near) {
      // What hangs off a caller that was left out goes with it, for the same reason.
      if ('definition' in link.near && !reached.has(key)) left.set(key, left.get(keyOf(link.near.definition)) ?? 'missing')
      continue
    }
    const known = reached.get(key)
    if (known && known.kind !== 'context') {
      if (link.direction === 'caller') changedCaller(known, near, link, link.call.line)
      continue
    }
    const spot = known ? await spotOf(known) : await locate(link.other, link.call.routes)
    if (!spot) {
      if (!known) left.set(key, 'missing')
      continue
    }

    // The call itself, at this commit: inside the caller for a caller, on the changed line for a callee. A route, a
    // config line or a render by convention has no call to find: its place at head is all there is to check.
    let line: number | null
    let where: { text: string; startLine: number; endLine: number } | null
    if (link.direction === 'caller' && (link.call.routes != null || link.call.renders === 'convention')) {
      line = spot.startLine
      where = spot
    } else if (link.direction === 'caller') {
      line = callIn(spot.text, spot.startLine, spot.endLine, link.call.name, spot.startLine + (link.call.line - link.other.startLine))
      where = spot
    } else {
      const path = 'changed' in link.near ? link.near.changed.path : near.subtitle
      const text = path ? await textOf(path) : null
      const holding = near.anchors.find((anchor) => anchor.side === 'added' && anchor.startLine <= link.call.line && link.call.line <= anchor.endLine)
      line = text != null && holding ? callIn(text, link.call.line, link.call.line, link.call.name, link.call.line) : null
      where = text != null && holding ? { text, startLine: holding.startLine, endLine: holding.endLine } : null
    }
    if (line == null || !where) {
      if (!known) left.set(key, 'missing')
      continue
    }

    let far = known
    if (!far) {
      // Lines the change touched are a node of the change already, and what calls them further out joins that node.
      if (touches(spot.path, spot.startLine, spot.endLine)) {
        const changed = holder(spot.path, spot.startLine)
        if (changed) {
          reached.set(key, changed)
          if (link.direction === 'caller') changedCaller(changed, near, link, line)
        }
        continue
      }
      far = placed.get(`${spot.fileId}:${spot.startLine}`)
      if (!far) {
        if (made >= VICINITY_LIMIT) {
          left.set(key, 'limit')
          continue
        }
        far = contextNode(`v${(made += 1)}`, link, spot)
        if (link.call.routes != null) doors.add(far.id)
        if (link.named) named.set(far.id, link.named)
        placed.set(`${spot.fileId}:${spot.startLine}`, far)
        nodes.push(far)
        if (!fileByPath.has(spot.path) && !graph.headFiles.has(spot.path)) {
          graph.headFiles.set(spot.path, spot.text)
          graph.files.push({ id: spot.path, path: spot.path, status: 'unchanged', binary: false, additions: 0, deletions: 0, summarized: false })
        }
      }
      reached.set(key, far)
      left.delete(key)
    }
    const guard = link.call.guards?.at(-1)
    const shownGuard = guard && sliceText(where.text, where.startLine, where.endLine).includes(guard.text) ? guard : undefined
    if (link.direction === 'caller' && far.id !== near.id && !(outward.get(near.id) ?? []).includes(far.id)) outward.set(near.id, [...(outward.get(near.id) ?? []), far.id])
    graph.wire(link.direction === 'callee' ? 'calls' : 'called-by', near.id, far.id, wireLabel(link, line, shownGuard))
  }

  for (const { changed, entry } of vicinity.entries ?? []) {
    const node = holder(changed.path, changed.line)
    if (node && ENTRY_KIND.test(entry.kind)) node.entry = { kind: entry.kind, exact: entry.exact === true }
  }
  sayTheWayIn(vicinity, nodes, outward, doors, named, (path, line) => holder(path, line))

  const why = [...left.values()]
  return noticesOf(vicinity, made, why.filter((reason) => reason === 'missing').length, why.filter((reason) => reason === 'limit').length)

  /** A changed caller: the change calls itself on its way in, so it is wired as the call it is, and walked as a way in. */
  function changedCaller(caller: ReviewNode, near: ReviewNode, link: VicinityLink, line: number) {
    if (caller.id === near.id || caller.kind !== 'code' || (outward.get(near.id) ?? []).includes(caller.id)) return
    outward.set(near.id, [...(outward.get(near.id) ?? []), caller.id])
    graph.wire('calls', caller.id, near.id, cleanProse(`line ${line}${link.proven ? '' : ', found by name'}`, PROSE_LIMIT.label))
  }

  async function spotOf(node: ReviewNode): Promise<Spot | null> {
    const anchor = node.anchors.find((entry) => entry.side === 'added')
    const path = node.subtitle
    const text = anchor && path ? await textOf(path) : null
    return anchor && path && text != null ? { path, fileId: anchor.fileId, text, startLine: anchor.startLine, endLine: anchor.endLine } : null
  }
}

function sliceText(text: string, startLine: number, endLine: number): string {
  return splitLines(text).slice(startLine - 1, endLine).join('\n')
}

/** A route's verbs and path, as the scan read them, when they are what a route can be. */
function routeOf(entry: ReviewEntry | undefined): ReviewEntry['route'] {
  const route = entry?.route
  if (!route || !Array.isArray(route.verbs) || route.verbs.length === 0 || !route.verbs.every((verb) => VERB.test(verb)) || typeof route.path !== 'string' || !route.path.startsWith('/')) return undefined
  return { verbs: [...route.verbs], path: cleanProse(route.path, PROSE_LIMIT.label) }
}

const routeWords = (route: NonNullable<ReviewEntry['route']>) => `${route.verbs.join('/')} ${route.path}`

function contextNode(id: string, link: VicinityLink, spot: Spot): ReviewNode {
  const route = routeOf(link.entry)
  const entry = link.entry && ENTRY_KIND.test(link.entry.kind) ? { kind: link.entry.kind, exact: link.entry.exact === true, ...(route ? { route } : {}) } : undefined
  const door = link.call.routes != null
  // A script's statement that runs from the command line goes by the script: bin/production-errors.
  const script = !door && entry?.kind === 'command'
  return {
    id,
    kind: 'context',
    title: cleanProse(route ? routeWords(route) : script ? spot.path : link.other.symbol, TITLE_LIMIT) || spot.path,
    subtitle: spot.path,
    change: 'unchanged',
    summary: cleanProse(entry && door ? doorWords(entry, spot, link.other.symbol, link.call.name) : `${roleWords(link)}${entry ? ` ${entryWords(entry, link.named ?? link.other.symbol)}` : ''}`, PROSE_LIMIT.summary),
    lifecycle: { role: link.direction, hops: link.hops },
    ...(entry ? { entry } : {}),
    anchors: [{ fileId: spot.fileId, side: 'added', startLine: spot.startLine, endLine: spot.endLine, hash: hashLines(spot.text, spot.startLine, spot.endLine) }],
    position: { x: 0, y: 0 },
  }
}

function roleWords({ direction, hops, call }: VicinityLink): string {
  if (direction === 'callee') return call.enqueues ? 'Unchanged. The change enqueues it to run later.' : 'Unchanged. The change calls it.'
  if (hops > 1) return `Unchanged. It leads to the change, ${hops} calls away.`
  if (call.reference) return `Unchanged. It uses ${call.name}, which the change touched.`
  if (call.renders) return 'Unchanged. It renders the change.'
  return call.enqueues ? 'Unchanged. It enqueues the change to run later.' : 'Unchanged. It calls the change.'
}

/** How a request comes in, said as sure as the scan is: a way in it is not sure of is only likely. */
const enters = (exact: boolean) => (exact ? 'A request enters here' : 'A request likely enters here')

/** An element and the prop that runs the code, as the scan names them: `button onClick` is the button's onClick. */
function elementWords(named: string): string {
  const at = named.lastIndexOf(' ')
  return at > 0 ? `the ${named.slice(0, at)}'s ${named.slice(at + 1)}` : `the ${named}`
}

/** Where a request enters, for the code there: what it is, and its name when the scan gives one, such as a handler's key. */
function entryWords({ kind, exact, route }: ReviewEntry, named: string): string {
  const comes = enters(exact)
  if (kind === 'controller') return `${comes}: a controller action${exact ? ' a route names' : ''}.`
  if (kind === 'job') return `${comes}: a job the queue runs.`
  if (kind === 'load') return 'It runs as its file loads, so the life cycle starts here.'
  if (kind === 'command') return `${comes}: it runs when the script is run from the command line.`
  if (kind === 'handler') return `${comes}: the handler ${named}.`
  if (kind === 'listener') return `${comes}: it runs on the ${named} event.`
  if (kind === 'ui-handler') return `${comes}: ${elementWords(named)}.`
  if (kind === 'task') return `${comes}: the task ${named}, run from the command line.`
  if (kind === 'mailer') return `${comes}: the mailer ${named}, which sends an email.`
  if (kind === 'channel') return `${comes}: the channel ${named}, which a browser calls over its socket.`
  if (kind === 'route' && route) return `${comes}: ${routeWords(route)}.`
  return `${comes} (${kind}).`
}

/** What a door says: where it sends a request, to the code the scan names. */
function doorWords(entry: ReviewEntry, spot: Spot, title: string, action: string): string {
  const comes = `Unchanged. ${enters(entry.exact)}`
  if (entry.kind === 'route' && entry.route) return `${comes}: ${spot.path} sends ${routeWords(entry.route)} to ${action}.`
  if (entry.kind === 'exceptions-app') return `${comes}: Rails sends a request that raised to its exceptions app, ${action}.`
  if (entry.kind === 'command') return `${comes}: ${spot.path} makes ${title} a command, which runs ${action}.`
  if (entry.kind === 'extension') return `${comes}: Pi loads ${title} as an extension, as ${spot.path} says, and calls ${action}.`
  if (entry.kind === 'export') return `${comes}: ${spot.path} exports ${action} as ${title}.`
  if (entry.kind === 'handler') return `${comes}: ${spot.path} makes ${action} the handler ${title}.`
  if (entry.kind === 'listener') return `${comes}: ${spot.path} runs ${action} on the ${title} event.`
  if (entry.kind === 'ui-handler') return `${comes}: ${spot.path} runs ${action} from ${elementWords(title)}.`
  return `${comes} (${entry.kind}).`
}

const capitalized = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

/**
 * How a way in starts, in words: a route by its verbs and path, a door or an entry by what sends the request, and by
 * its own name, such as a handler's key, where the scan gives one. The last of them is the origin's label.
 */
function openingWords(node: ReviewNode, title: string, named = title): string[] {
  const route = routeOf(node.entry)
  if (route) return [routeWords(route)]
  const kind = node.entry?.kind
  if (kind === 'exceptions-app') return ['A failing request', title]
  if (kind === 'job') return ['The job queue', title]
  // A command goes by its name, a script by its path: agentic-search (command), bin/production-errors (command).
  if (kind === 'command') return [`${node.kind === 'context' ? node.title : (node.subtitle ?? title)} (command)`]
  if (kind === 'extension') return [`Pi extension ${title}`]
  if (kind === 'export') return [`Export ${title}`]
  if (kind === 'handler') return [`The handler ${named}`]
  if (kind === 'listener') return [`The ${named} event`]
  if (kind === 'ui-handler') return [capitalized(elementWords(named))]
  if (kind === 'task' || kind === 'mailer' || kind === 'channel') return [`The ${kind} ${named}`]
  return [title]
}

/** The opening of a way in as its line says it: a way in the scan is not sure of says it is only likely. */
const sureWords = (node: ReviewNode, opening: readonly string[]) => (node.entry?.exact === false ? [...opening.slice(0, -1), `${opening.at(-1)} (likely)`] : [...opening])

/** The way in as one line, cut in its middle when it is too long, so where it starts and the change itself both show. */
function wayWords(parts: readonly string[]): string {
  const line = parts.join(' → ')
  if (Array.from(line).length <= PROSE_LIMIT.summary) return line
  for (let keep = parts.length - 1; keep >= 2; keep -= 1) {
    const head = Math.ceil(keep / 2)
    const cut = [...parts.slice(0, head), '…', ...parts.slice(parts.length - (keep - head))].join(' → ')
    if (Array.from(cut).length <= PROSE_LIMIT.summary) return cut
  }
  return cleanProse(line, PROSE_LIMIT.summary)
}

/**
 * Where each way in from a node starts, nearest first: a door, or an entry no door is before. Nothing past an entry is
 * followed, so a way in is counted once however far its callers go on.
 */
function waysInFrom(start: string, byId: ReadonlyMap<string, ReviewNode>, outward: ReadonlyMap<string, readonly string[]>, doors: ReadonlySet<string>): Set<string> {
  const ends = new Set<string>()
  const seen = new Set([start])
  for (const queue = [start]; queue.length > 0; ) {
    const id = queue.shift()!
    if (doors.has(id)) {
      ends.add(id)
      continue
    }
    if (byId.get(id)?.entry) {
      const own = (outward.get(id) ?? []).filter((next) => doors.has(next))
      for (const door of own.length ? own : [id]) ends.add(door)
      continue
    }
    for (const next of outward.get(id) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return ends
}

/**
 * Says on each changed definition the scan looked around the way a request takes to it, along the called-by wires: the
 * nearest entry, with the door one step before it when there is one, and how many calls out the entry is. The way is
 * kept as node ids too, the origin first, with its kind and words, and how many other ways in there are. Where no way
 * reaches an entry, it says how far the scan looked, where the way out stops, and why in a word. Changed code the scan
 * did not look around says that nothing was looked for.
 */
function sayTheWayIn(vicinity: Vicinity, nodes: ReviewNode[], outward: ReadonlyMap<string, readonly string[]>, doors: ReadonlySet<string>, named: ReadonlyMap<string, string>, holder: (path: string, line: number) => ReviewNode | undefined) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const reachOf = new Map<string, VicinityReach>()
  for (const reach of vicinity.reach ?? []) {
    const node = holder(reach.changed.path, reach.changed.line)
    if (node && !reachOf.has(node.id)) reachOf.set(node.id, reach)
  }
  const doorOf = (id: string) => (outward.get(id) ?? []).map((next) => byId.get(next)).find((node) => node != null && doors.has(node.id))
  for (const node of nodes) {
    if (node.kind !== 'code' || node.change === 'unchanged') continue
    const reach = reachOf.get(node.id)
    // Removed code, and code the scan had no anchor for, were never walked.
    const walked = node.change !== 'deleted' && node.anchors.some((anchor) => anchor.side === 'added') && (reach != null || outward.has(node.id) || node.entry != null)
    if (!walked) {
      node.lifecycle = { role: 'changed', hops: 0, none: 'not-looked' }
      continue
    }
    // Breadth first, so the nearest entry wins, and among as near the first the scan ranked.
    const before = new Map<string, string | null>([[node.id, null]])
    const depth = new Map<string, number>([[node.id, 0]])
    let found: string | null = node.entry ? node.id : null
    for (const queue = [node.id]; queue.length > 0 && found == null; ) {
      const id = queue.shift()!
      for (const next of outward.get(id) ?? []) {
        if (before.has(next)) continue
        before.set(next, id)
        depth.set(next, depth.get(id)! + 1)
        if (byId.get(next)?.entry) {
          found = next
          break
        }
        queue.push(next)
      }
    }
    const chainTo = (end: string) => {
      const chain: ReviewNode[] = []
      for (let id: string | null | undefined = end; id != null; id = before.get(id)) chain.unshift(byId.get(id)!)
      return chain
    }
    if (found != null) {
      // From where the request comes in to the change: a door, the code it reaches, and on to the change.
      const entry = byId.get(found)!
      const door = doors.has(entry.id) ? undefined : doorOf(found)
      const way = [...(door ? [door] : []), ...chainTo(found).reverse()]
      const hops = depth.get(found)! - (doors.has(entry.id) ? 1 : 0)
      // Changed code by the name the scan reads it by, such as ErrorsController#show, when it has one.
      const name = (step: ReviewNode) => (step.kind === 'code' ? reachOf.get(step.id)?.symbol : undefined) ?? step.title
      const start = way[0]!
      const opening = openingWords(start, name(start), named.get(start.id))
      const more = waysInFrom(node.id, byId, outward, doors).size - 1
      node.lifecycle = {
        role: 'changed',
        hops: Math.max(0, Math.min(9, hops)),
        path: wayWords([...sureWords(start, opening), ...way.slice(1).map(name)]),
        ...(start.entry ? { origin: originOf(start.entry, opening.at(-1)!, way.slice(0, -1), more) } : {}),
      }
      continue
    }
    // The furthest the way out goes, the first ranked among as far.
    const furthest = [...depth].reduce((best, next) => (next[1] > best[1] ? next : best))
    const top = furthest[1] > 0 ? byId.get(furthest[0]) : undefined
    node.lifecycle = {
      role: 'changed',
      hops: Math.min(9, furthest[1]),
      path: cleanProse(noWayWords(node, top, reach), PROSE_LIMIT.summary),
      none: noWayReason(top, reach),
    }
  }
}

/** Where a way in starts, as the review keeps it: the origin's kind and words, and the ids from it to the node's own caller. */
function originOf(entry: ReviewEntry, label: string, steps: readonly ReviewNode[], more: number): NonNullable<ReviewLifecycle['origin']> {
  return {
    kind: entry.kind,
    label: cleanProse(label, TITLE_LIMIT),
    exact: entry.exact,
    chain: steps.map((step) => step.id),
    ...(more > 0 ? { more } : {}),
  }
}

/** Every call site the scan counted for it is in a test. */
const onlyTests = (reach: VicinityReach | undefined) => (reach?.testCallers ?? 0) > 0 && reach?.callers === 0

/** Why no way in was found, in a word: nothing calls it, only tests do, or the walk stopped before an entry. */
function noWayReason(top: ReviewNode | undefined, reach: VicinityReach | undefined): NonNullable<ReviewLifecycle['none']> {
  if (!top) return onlyTests(reach) ? 'only-tests' : 'no-callers'
  return reach?.stopped ?? 'no-callers'
}

/** Why no way in was found, by how far the scan looked: the calls it may follow, the time it had, or no caller left. */
function noWayWords(node: ReviewNode, top: ReviewNode | undefined, reach: VicinityReach | undefined): string {
  const door = /\.(?:rb|rake|erb|haml|slim|jbuilder|builder)$/.test(node.subtitle ?? '') ? 'route' : 'entry point'
  if (!top) return onlyTests(reach) ? `No ${door} reaches it: only tests call it.` : `No ${door} reaches it: the scan found nothing that calls it.`
  if (reach?.stopped === 'limit') return `No ${door} reaches it within ${LIFE_CYCLE.hops} calls: the way out stops at ${top.title}.`
  if (reach?.stopped === 'time') return `No ${door} reaches it within the ${count(reach.hops, 'call')} the scans could follow: the way out stops at ${top.title}.`
  return `No ${door} reaches it: nothing the scan could find calls ${top.title}.`
}

/** What a door does to the code it reaches, for its wire. */
const DOOR_VERB: Record<string, string> = {
  route: 'routes it',
  'exceptions-app': 'sends it failing requests',
  command: 'runs it',
  extension: 'loads it',
  export: 'exports it',
  handler: 'names it a handler',
  listener: 'runs it on an event',
  'ui-handler': 'runs it from the interface',
}

const KEYWORD = /^(?:if|elsif|else if|unless|while|until|case|when|switch|for)\b/

/** A condition a call sits under, in words: a statement that starts with a keyword is named, any other text is a test. */
function guardWords({ text, branch }: VicinityGuard): string {
  if (branch === 'after-return') return `after ${text} returns`
  if (KEYWORD.test(text)) return branch === 'then' ? `inside ${text}` : `in the else of ${text}`
  return branch === 'then' ? `when ${text}` : `when not ${text}`
}

/** Where the call is, what it sits under, and whether only its name ties it to the other end. */
function wireLabel(link: VicinityLink, line: number, guard: VicinityGuard | undefined): string {
  const { call } = link
  const where =
    link.direction === 'callee'
      ? call.enqueues
        ? `enqueued on line ${line}`
        : `line ${line}`
      : call.routes != null
        ? `${DOOR_VERB[link.entry?.kind ?? ''] ?? 'sends it requests'} from line ${line}`
        : call.renders === 'convention'
          ? 'renders it by convention'
          : call.renders
            ? `renders it from line ${line}`
            : call.reference
              ? `uses it on line ${line}`
              : call.enqueues
                ? `enqueues it from line ${line}`
                : `from line ${line}`
  // A call in a property's value says which one, as a handler map's key.
  const within = link.direction === 'caller' && call.key ? `${where} in ${call.key}` : where
  const condition = guard && guardWords(guard)
  return cleanProse([within, ...(condition ? [condition] : []), ...(link.proven ? [] : ['found by name'])].join(', '), PROSE_LIMIT.label)
}

/** The scan's own notice, and a line on what the life cycle shows and what it left out, with why. */
function noticesOf(vicinity: Vicinity, shown: number, missing: number, overLimit: number): string[] {
  const { byName = 0, perDefinition = 0, further = 0, partial = 0, aside = 0 } = vicinity.left ?? {}
  const leftOut = [
    overLimit ? `${overLimit} past the limit of ${VICINITY_LIMIT}` : '',
    missing ? `${missing} not found at this commit` : '',
    byName ? `${count(byName, 'caller')} matched only by name` : '',
    perDefinition ? `${perDefinition} past the ${LIFE_CYCLE.callers} callers and ${LIFE_CYCLE.callees} callees kept for each definition` : '',
    aside ? `${count(aside, 'caller')} on other ways out, past the ${LIFE_CYCLE.ways} kept for each change` : '',
  ].filter(Boolean)
  const reach = [
    further ? `the callers of ${count(further, 'definition')} go further than the ${LIFE_CYCLE.hops} calls followed` : '',
    partial ? `the scan could not list every caller of ${partial}` : '',
  ].filter(Boolean)
  const said: string[] = []
  if (leftOut.length || reach.length) {
    said.push(`The life cycle around the change shows ${count(shown, 'unchanged definition')}.`)
    if (leftOut.length) said.push(`Left out: ${listed(leftOut)}.`)
    if (reach.length) said.push(`${reach.join(', and ').replace(/^t/, 'T')}.`)
  } else if (shown === 0 && !vicinity.notice) said.push('The call-graph scan found no unchanged code that calls the change or that its changed lines call.')
  return [vicinity.notice ?? '', said.join(' ')].map((text) => cleanProse(text, HOST_TEXT_LIMIT)).filter(Boolean)
}
