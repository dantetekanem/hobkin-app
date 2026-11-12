/**
 * The vicinity of a change: the request's life cycle around it, found by a static call-graph scan (agentic-search).
 * What calls the changed code, what calls that, and so on out to where a request enters, becomes context wired with
 * `called-by`; what the changed lines call becomes context wired with `calls`. The host runs the scan and hands its
 * links here as data, the most telling first. The host owns every code range: each definition is found again in the
 * file at head, and one that is not there, that no longer makes the call, or that the change itself touched, is left
 * out. Past the limit the rest are left out too, and the review says what was, and why.
 */
import type { Capture } from './capture.ts'
import { hashLines, splitLines } from './lines.ts'
import { cleanProse, count, isSafePath, listed } from './prose.ts'
import { HOST_TEXT_LIMIT, PROSE_LIMIT, TITLE_LIMIT, type EdgeKind, type ReviewEntry, type ReviewFile, type ReviewNode } from './types.ts'
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
  /** The name it calls: the callee's own name. */
  name: string
  /** The conditions it sits under, outermost first. */
  guards?: VicinityGuard[]
  /** It only enqueues the callee, which runs later on its own (a job's perform). */
  enqueues?: boolean
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
}

export interface Vicinity {
  links: VicinityLink[]
  /** Changed definitions where a request enters, as the scan says. */
  entries?: { changed: { path: string; line: number }; entry: ReviewEntry }[]
  /** What the review should say about the scan itself: that it could not run, or stopped early. */
  notice?: string
  left?: VicinityLeft
}

/** The most unchanged definitions a review shows around its change, so the graph stays readable. */
export const VICINITY_LIMIT = 20

/** How far out the life cycle is followed, and how many callers and callees are kept for each definition, best first. */
export const LIFE_CYCLE = { hops: 4, callers: 3, callees: 3 } as const

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
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Adds the life cycle's context nodes and their wires to a draft, in the order the links come, and answers what the
 * review should say about it.
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

  /** The definition at head, by its name, nearest where the scan saw it; a statement by the words it starts with. */
  const locate = async (definition: VicinityDefinition): Promise<Spot | null> => {
    if (!isSafePath(definition.path) || !(definition.startLine >= 1 && definition.endLine >= definition.startLine)) return null
    const text = await textOf(definition.path)
    if (text == null) return null
    const symbol = definition.symbol.trim().replace(/\s+/g, ' ')
    const name = declaredName(symbol)
    let found = IDENTIFIER.test(name) ? declarationsOf(text, name) : []
    if (found.length === 0 && symbol) {
      found = splitLines(text).flatMap((line, index) => (line.trim().replace(/\s+/g, ' ').startsWith(symbol) ? [blockAt(text, index + 1)!] : []))
    }
    if (found.length === 0) return null
    const nearest = found.reduce((best, next) => (Math.abs(next.startLine - definition.startLine) < Math.abs(best.startLine - definition.startLine) ? next : best))
    return { path: definition.path, fileId: fileByPath.get(definition.path)?.id ?? definition.path, text, ...nearest }
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
    if (known && known.kind !== 'context') continue
    const spot = known ? await spotOf(known) : await locate(link.other)
    if (!spot) {
      if (!known) left.set(key, 'missing')
      continue
    }

    // The call itself, at this commit: inside the caller for a caller, on the changed line for a callee.
    let line: number | null
    let where: { text: string; startLine: number; endLine: number } | null
    if (link.direction === 'caller') {
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
        if (changed) reached.set(key, changed)
        continue
      }
      far = placed.get(`${spot.fileId}:${spot.startLine}`)
      if (!far) {
        if (made >= VICINITY_LIMIT) {
          left.set(key, 'limit')
          continue
        }
        far = contextNode(`v${(made += 1)}`, link, spot)
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
    graph.wire(link.direction === 'callee' ? 'calls' : 'called-by', near.id, far.id, wireLabel(link, line, shownGuard))
  }

  for (const { changed, entry } of vicinity.entries ?? []) {
    const node = holder(changed.path, changed.line)
    if (node && ENTRY_KIND.test(entry.kind)) node.entry = { kind: entry.kind, exact: entry.exact === true }
  }

  const why = [...left.values()]
  return noticesOf(vicinity, made, why.filter((reason) => reason === 'missing').length, why.filter((reason) => reason === 'limit').length)

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

function contextNode(id: string, link: VicinityLink, spot: Spot): ReviewNode {
  const entry = link.entry && ENTRY_KIND.test(link.entry.kind) ? { kind: link.entry.kind, exact: link.entry.exact === true } : undefined
  return {
    id,
    kind: 'context',
    title: cleanProse(link.other.symbol, TITLE_LIMIT) || spot.path,
    subtitle: spot.path,
    change: 'unchanged',
    summary: cleanProse(`${roleWords(link)}${entry ? ` ${entryWords(entry)}` : ''}`, PROSE_LIMIT.summary),
    lifecycle: { role: link.direction, hops: link.hops },
    ...(entry ? { entry } : {}),
    anchors: [{ fileId: spot.fileId, side: 'added', startLine: spot.startLine, endLine: spot.endLine, hash: hashLines(spot.text, spot.startLine, spot.endLine) }],
    position: { x: 0, y: 0 },
  }
}

function roleWords({ direction, hops, call }: VicinityLink): string {
  if (direction === 'callee') return call.enqueues ? 'Unchanged. The change enqueues it to run later.' : 'Unchanged. The change calls it.'
  if (hops > 1) return `Unchanged. It leads to the change, ${hops} calls away.`
  return call.enqueues ? 'Unchanged. It enqueues the change to run later.' : 'Unchanged. It calls the change.'
}

function entryWords({ kind, exact }: ReviewEntry): string {
  if (kind === 'controller') return `A request enters here: a controller action${exact ? ' a route names' : ''}.`
  if (kind === 'job') return 'A request enters here: a job the queue runs.'
  if (kind === 'load') return 'It runs as its file loads, so the life cycle starts here.'
  return `A request enters here (${kind}).`
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
  const where =
    link.direction === 'callee' ? (link.call.enqueues ? `enqueued on line ${line}` : `line ${line}`) : link.call.enqueues ? `enqueues it from line ${line}` : `from line ${line}`
  const condition = guard && guardWords(guard)
  return cleanProse([where, ...(condition ? [condition] : []), ...(link.proven ? [] : ['found by name'])].join(', '), PROSE_LIMIT.label)
}

/** The scan's own notice, and a line on what the life cycle shows and what it left out, with why. */
function noticesOf(vicinity: Vicinity, shown: number, missing: number, overLimit: number): string[] {
  const { byName = 0, perDefinition = 0, further = 0, partial = 0 } = vicinity.left ?? {}
  const leftOut = [
    overLimit ? `${overLimit} past the limit of ${VICINITY_LIMIT}` : '',
    missing ? `${missing} not found at this commit` : '',
    byName ? `${count(byName, 'caller')} matched only by name` : '',
    perDefinition ? `${perDefinition} past the ${LIFE_CYCLE.callers} callers and ${LIFE_CYCLE.callees} callees kept for each definition` : '',
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
