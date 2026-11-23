/**
 * The way in to changed code (spec 055): where it is run from, such as a request, a job or a command, and each call
 * between that and the change, the origin first. The host's chain wins when the review has one (`lifecycle.origin`).
 * Without it the nearest way in is found here, breadth first up the call wires, the review's order breaking a tie, and
 * the other ways in are counted. A way in is a place a request enters (`entry`) that nothing calls; one that something
 * calls, such as a controller action its route reaches, is passed on the way. With none found it says why, in the
 * review's words when it has them. Pure.
 */
import type { ReviewEdge, ReviewEntry, ReviewLifecycle, ReviewNode } from '#shared/review/types.ts'

/** What the way in reads of a node. */
export type TrailNode = Pick<ReviewNode, 'id' | 'kind' | 'change'> & Partial<Pick<ReviewNode, 'title' | 'entry' | 'lifecycle' | 'unwired'>>

export interface TrailGraph {
  nodes: readonly TrailNode[]
  edges: readonly Pick<ReviewEdge, 'from' | 'to' | 'kind'>[]
}

/** Where a way in starts: its kind of entry, its words, and whether a route or a declaration says so. */
export interface Origin {
  kind: string
  label: string
  exact: boolean
}

export interface Trail {
  /** The way in as node ids: the origin first and the node's own caller last. Empty with no way in, or when it is its own. */
  chain: string[]
  origin: Origin | null
  /** How many other ways in there are. */
  more: number
  /** With no way in, why, in a line. Null when there is one. */
  why: string | null
}

const NO_WAY_IN: Record<NonNullable<ReviewLifecycle['none']>, string> = {
  'no-callers': 'The scan found no caller.',
  'only-tests': 'Only tests call it.',
  limit: 'The scan stopped before it reached a way in.',
  time: 'The scan ran out of time before it reached a way in.',
  'not-looked': 'Its way in was not looked for.',
}

const KIND_WORDS: Readonly<Record<string, string>> = {
  route: 'Request',
  controller: 'Request',
  'exceptions-app': 'Failed request',
  job: 'Job',
  command: 'Command',
  task: 'Task',
  listener: 'Listener',
  load: 'On load',
}

/** What kind of way in it is, in plain words: a request, a job, a command, a task, a listener. */
export function originWords(kind: string): string {
  return KIND_WORDS[kind] ?? `${kind.charAt(0).toUpperCase()}${kind.slice(1).replaceAll('-', ' ')}`
}

/** True for a part of the change: code or a file the change touched. Only these have a way in to tell. */
export function isChangedCode(node: Pick<ReviewNode, 'kind' | 'change'> | undefined): boolean {
  return node != null && (node.kind === 'code' || node.kind === 'file') && node.change !== 'unchanged'
}

/** The two ends of a call wire, or null for any other wire. A `called-by` wire runs from the code its caller calls. */
function callOf(edge: TrailGraph['edges'][number]): { caller: string; callee: string } | null {
  if (edge.kind === 'calls') return { caller: edge.from, callee: edge.to }
  if (edge.kind === 'called-by') return { caller: edge.to, callee: edge.from }
  return null
}

/** Who calls each node along the call wires, each once, in the review's order. */
function callersOf(graph: TrailGraph, index: ReadonlyMap<string, number>): Map<string, string[]> {
  const callers = new Map<string, string[]>()
  for (const edge of graph.edges) {
    const call = callOf(edge)
    if (!call || call.caller === call.callee || !index.has(call.caller) || !index.has(call.callee)) continue

    const known = callers.get(call.callee) ?? []
    if (!known.includes(call.caller)) callers.set(call.callee, [...known, call.caller])
  }
  for (const list of callers.values()) list.sort((a, b) => index.get(a)! - index.get(b)!)
  return callers
}

/** Where a way in starts: the node a request enters by, and how it enters. */
function originOf(node: TrailNode, entry: ReviewEntry): Origin {
  return {
    kind: entry.kind,
    label: node.title ?? node.id,
    exact: entry.exact,
  }
}

/**
 * The ways in found up the call wires from a node, a level at a time and each level in the review's order, so the
 * nearest comes first: those nothing calls, else every entry reached. With each node reached, the node it was reached
 * from, one call nearer the change.
 */
function walkUp(graph: TrailGraph, id: string, index: ReadonlyMap<string, number>, callers: ReadonlyMap<string, readonly string[]>) {
  const towardChange = new Map<string, string>()
  const seen = new Set([id])
  const roots: string[] = []
  const entries: string[] = []

  let level = [id]
  while (level.length > 0) {
    const next: string[] = []
    for (const at of level) {
      for (const caller of callers.get(at) ?? []) {
        if (seen.has(caller)) continue
        seen.add(caller)
        towardChange.set(caller, at)
        next.push(caller)
      }
    }
    next.sort((a, b) => index.get(a)! - index.get(b)!)

    for (const reached of next) {
      if (!graph.nodes[index.get(reached)!]!.entry) continue
      entries.push(reached)
      if ((callers.get(reached) ?? []).length === 0) roots.push(reached)
    }
    level = next
  }

  return { ways: roots.length > 0 ? roots : entries, towardChange }
}

/** Why a part of the change has no way in: the review's reason, an older review's line, why nothing wires it, or what the graph shows. */
function whyNone(node: TrailNode, called: boolean): string {
  const none = node.lifecycle?.none
  if (none) return NO_WAY_IN[none]
  if (node.lifecycle?.path) return node.lifecycle.path
  if (node.unwired) return node.unwired
  return called ? 'None of its callers in the review leads to a way in.' : 'The review shows no caller of it.'
}

/** The way in to a part of the change, or null for anything else. */
export function trailOf(graph: TrailGraph, id: string): Trail | null {
  const index = new Map(graph.nodes.map((node, at) => [node.id, at]))
  const node = graph.nodes[index.get(id) ?? -1]
  if (!node || !isChangedCode(node)) return null

  const told = node.lifecycle?.origin
  if (told) {
    return {
      chain: [...told.chain],
      origin: { kind: told.kind, label: told.label, exact: told.exact },
      more: told.more ?? 0,
      why: null,
    }
  }

  const callers = callersOf(graph, index)
  const { ways, towardChange } = walkUp(graph, id, index, callers)
  const start = ways[0]
  if (start != null) {
    const chain: string[] = []
    for (let at = start; at !== id; at = towardChange.get(at)!) chain.push(at)
    // Every way in the walk found is an entry.
    const origin = graph.nodes[index.get(start)!]!
    return { chain, origin: originOf(origin, origin.entry!), more: ways.length - 1, why: null }
  }

  // Code a request enters by itself, with nothing above it, is its own way in.
  if (node.entry) return { chain: [], origin: originOf(node, node.entry), more: 0, why: null }

  const called = (callers.get(id) ?? []).length > 0
  return { chain: [], origin: null, more: 0, why: whyNone(node, called) }
}

/** Enough of the graph as drawn to find a way in on it: each folded node's card, and each folded test's. */
export interface DrawnTrailGraph extends TrailGraph {
  foldOf?: Readonly<Record<string, string>>
  groupOf?: Readonly<Record<string, string>>
}

/**
 * The way in as the graph draws it, origin first and the node itself last: each hop on the card that stands for it, a
 * hop folded into a group on its group's card, and a hop the graph does not draw left out.
 */
export function drawnTrail(graph: DrawnTrailGraph, id: string): string[] {
  const trail = trailOf(graph, id)
  if (!trail) return []
  const drawn = new Set(graph.nodes.map((node) => node.id))
  const cardOf = (hop: string) => {
    const card = graph.groupOf?.[hop] ?? hop
    return graph.foldOf?.[card] ?? card
  }
  const hops = [...trail.chain, id].map(cardOf).filter((hop) => drawn.has(hop))
  return hops.filter((hop, at) => hops.indexOf(hop) === at)
}
