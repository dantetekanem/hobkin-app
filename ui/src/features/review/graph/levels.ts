/**
 * How present each node and wire is, given what is focused and what the pointer is over.
 * Pure, so the levels of a step can be tested without drawing anything.
 */
import { NODE_SIZE } from '#shared/review/layout.ts'
import type { ReviewEdge, ReviewNode, StoryStep } from '#shared/review/types.ts'
import { drawnTrail } from './trail.ts'

/**
 * `rest`: nothing is focused, the whole graph is shown.
 * `focus`: sharp, with an accent ring. `neighbor`: on a wire the focus draws, dimmed and sharp.
 * `background`: everything else, settled back.
 */
export type NodeLevel = 'rest' | 'focus' | 'neighbor' | 'background'
/**
 * `bright`: the step's own path, the wires the story walks into and out of its focus, and those between its nodes.
 * `near`: the rest of the focus's life cycle, drawn quietly. `faded`: every other wire while there is a focus.
 * `folded`: one wire too many from a focus node. It is not drawn, and the node counts it instead.
 */
export type WireLevel = 'rest' | 'bright' | 'near' | 'faded' | 'folded'
/** `lit` is the hovered node, its wires and its neighbors. `dim` is everything else while something is hovered. */
export type HoverLevel = 'none' | 'lit' | 'dim'

/** What a focus node folded away: the nodes at the far end of the wires it does not draw, on each of its sides. */
export interface Folded {
  /** Wires that arrive at its left pin. */
  in: string[]
  /** Wires that leave its right pin. */
  out: string[]
}

export interface Levels<NodeValue, WireValue> {
  nodes: Record<string, NodeValue>
  wires: Record<string, WireValue>
  /** What each focus node folded away. Only the levels of a focus have it. */
  folded?: Record<string, Folded>
}

/** Enough of a graph to light it up under the pointer. */
export interface Wired {
  nodes: readonly { id: string }[]
  edges: readonly Pick<ReviewEdge, 'id' | 'from' | 'to'>[]
}

/**
 * Enough of a graph to tell a focus's path from its life cycle: what each node is, where it sits, where requests enter
 * and how the story rides, and for the graph as drawn, the card each folded node is on.
 */
export interface Graph {
  nodes: readonly (Pick<ReviewNode, 'id' | 'kind' | 'change' | 'position'> & Partial<Pick<ReviewNode, 'title' | 'entry' | 'lifecycle'>>)[]
  edges: readonly Pick<ReviewEdge, 'id' | 'from' | 'to' | 'kind'>[]
  story?: readonly Pick<StoryStep, 'focus' | 'travel'>[]
  foldOf?: Readonly<Record<string, string>>
  groupOf?: Readonly<Record<string, string>>
}

/**
 * How many wires one focus node draws before the rest fold: to code of the change, and to the code it did not touch
 * that calls it and that it calls.
 */
export const SHOWN = { changed: 6, callers: 2, callees: 2 } as const
/** How far the life cycle is followed on through unchanged code past the focus's own neighbors, and how many ways at each node. */
export const ONWARD = { depth: 3, ways: 2 } as const

/** Code the change did not touch: the callers and callees around it, or a test a Proof line names. An acceptance line is not code. */
export function isUnchanged(node: Pick<ReviewNode, 'kind' | 'change'> | undefined): boolean {
  return node != null && node.kind !== 'criterion' && node.change === 'unchanged'
}

type Edge = Graph['edges'][number]

/** True when the far end of a wire is upstream of `id`, toward where the request comes in: a caller, a test or a promise. */
function upstream(edge: Edge, id: string): boolean {
  // `called-by` is drawn from the changed code to its caller, so the caller is the wire's far end.
  return edge.kind === 'called-by' ? edge.from === id : edge.to === id
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id))
const byId = (a: Edge, b: Edge) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** How many times the levels of a focus were worked out, not taken from the last time: a move costs one (spec 053). */
export const levelsWork = { runs: 0 }
/** The last levels worked out, with the graph and the focus they were for. */
let last: (Pick<Graph, 'nodes' | 'edges' | 'story'> & { focus: string; levels: Levels<NodeLevel, WireLevel> }) | null = null

/**
 * The levels of a focus, worked out once for a graph and a focus: a move asks for them twice, once to say what draws in
 * and once to draw it, and the second time takes the first's.
 */
export function focusLevels(graph: Graph, focus: readonly string[]): Levels<NodeLevel, WireLevel> {
  const key = focus.join('\u0000')
  if (
    last?.focus === key &&
    last.nodes === graph.nodes &&
    last.edges === graph.edges &&
    last.story === graph.story
  ) {
    return last.levels
  }

  levelsWork.runs += 1
  const levels = levelsOf(graph, focus)
  last = { nodes: graph.nodes, edges: graph.edges, story: graph.story, focus: key, levels }
  return levels
}

/**
 * The levels of a focus. Its own path stands out: the wires between its nodes, the wire the story rides in on and
 * the one it leaves by for the next step. Around that, each focus node draws its life cycle quietly: a few wires to the
 * change's code, nearest first, and two callers and two callees the change did not touch, the ones that lead further
 * first and then as the review lists them, most telling first. From those callers the life cycle is followed on through
 * unchanged code, out to where the request comes in. Whatever is left folds into a count on the node, so a node with
 * twenty callees draws a few wires, not a fan of twenty. The way in to a focus node that is changed code (`trail.ts`)
 * is drawn whole, however far it starts (spec 055).
 */
function levelsOf(graph: Graph, focus: readonly string[]): Levels<NodeLevel, WireLevel> {
  const focused = new Set(focus)
  const nodes: Record<string, NodeLevel> = {}
  const wires: Record<string, WireLevel> = {}
  if (focused.size === 0) {
    for (const node of graph.nodes) nodes[node.id] = 'rest'
    for (const edge of graph.edges) wires[edge.id] = 'rest'
    return { nodes, wires }
  }

  const nodeOf = new Map(graph.nodes.map((node) => [node.id, node]))
  const listed = new Map(graph.nodes.map((node, index) => [node.id, index]))
  const touching = new Map<string, Edge[]>(graph.nodes.map((node) => [node.id, []]))
  for (const edge of graph.edges) {
    wires[edge.id] = 'faded'
    touching.get(edge.from)?.push(edge)
    if (edge.to !== edge.from) touching.get(edge.to)?.push(edge)
  }
  const unchanged = (id: string) => isUnchanged(nodeOf.get(id))
  const across = (edge: Edge, id: string) => (edge.from === id ? edge.to : edge.from)
  const middle = (id: string) => {
    const node = nodeOf.get(id)
    return node ? node.position.y + NODE_SIZE[node.kind].height / 2 : 0
  }
  const apart = (edge: Edge, id: string) => Math.abs(middle(across(edge, id)) - middle(id))
  /** Where the review lists the far end of the wire. The host lists the life cycle most telling first. */
  const order = (edge: Edge, id: string) => listed.get(across(edge, id)) ?? 0
  /** The far end of the wire goes on to more code the change did not touch. */
  const leads = (edge: Edge, id: string) => {
    const other = across(edge, id)
    return (touching.get(other) ?? []).some((next) => next !== edge && !focused.has(across(next, other)) && unchanged(across(next, other)))
  }
  const telling = (id: string) => (a: Edge, b: Edge) => Number(leads(b, id)) - Number(leads(a, id)) || order(a, id) - order(b, id) || byId(a, b)

  // The step this focus is, for the wires the story rides into it on and out of it by.
  const at = graph.story?.findIndex((step) => sameIds(step.focus, focus)) ?? -1
  const path = new Set(at >= 0 ? [graph.story![at]!.travel, graph.story![at + 1]?.travel].filter((id): id is string => Boolean(id)) : [])

  const shown = new Set<string>()
  const folded: Record<string, Folded> = {}
  /** Draws a wire from a focus node quietly, or folds it into the node's count on the side it would leave by. */
  const keep = (edge: Edge, id: string, drawn: boolean, fold: Folded) => {
    wires[edge.id] = drawn ? 'near' : 'folded'
    if (drawn) shown.add(across(edge, id))
    else fold[edge.to === id ? 'in' : 'out'].push(across(edge, id))
  }
  for (const id of focus) {
    if (!nodeOf.has(id)) continue
    const fold: Folded = { in: [], out: [] }
    folded[id] = fold
    const changed: Edge[] = []
    const callers: Edge[] = []
    const callees: Edge[] = []
    for (const edge of touching.get(id) ?? []) {
      const other = across(edge, id)
      if (focused.has(other) || path.has(edge.id)) {
        wires[edge.id] = 'bright'
        if (!focused.has(other)) shown.add(other)
      } else if (!unchanged(other)) {
        changed.push(edge)
      } else if (upstream(edge, id)) {
        callers.push(edge)
      } else {
        callees.push(edge)
      }
    }
    changed.sort((a, b) => apart(a, id) - apart(b, id) || order(a, id) - order(b, id) || byId(a, b))
    callers.sort(telling(id))
    callees.sort(telling(id))
    for (const [index, edge] of changed.entries()) keep(edge, id, index < SHOWN.changed, fold)
    for (const [index, edge] of callers.entries()) keep(edge, id, index < SHOWN.callers, fold)
    for (const [index, edge] of callees.entries()) keep(edge, id, index < SHOWN.callees, fold)
  }

  // The life cycle goes on through code the change did not touch: a caller's own callers, out to where the request comes in.
  const reached = new Set([...focused, ...shown])
  let frontier = [...shown].filter(unchanged)
  for (let depth = 0; depth < ONWARD.depth && frontier.length > 0; depth += 1) {
    const next: string[] = []
    for (const id of frontier) {
      const onward = (touching.get(id) ?? [])
        .filter((edge) => wires[edge.id] === 'faded' && unchanged(across(edge, id)) && !focused.has(across(edge, id)))
        .sort((a, b) => Number(upstream(b, id)) - Number(upstream(a, id)) || order(a, id) - order(b, id) || byId(a, b))
        .slice(0, ONWARD.ways)
      for (const edge of onward) {
        wires[edge.id] = 'near'
        const other = across(edge, id)
        if (reached.has(other)) continue
        reached.add(other)
        shown.add(other)
        next.push(other)
      }
    }
    frontier = next
  }

  // The way in to each focus node, from where it starts: every hop, and the wire between each two, a folded one too.
  /** Takes a wire a focus node folded off its count, so it is drawn and no longer counted. */
  const unfold = (end: string, other: string) => {
    for (const side of [folded[end]?.in, folded[end]?.out]) {
      const at = side?.indexOf(other) ?? -1
      if (at >= 0) side!.splice(at, 1)
    }
  }
  for (const id of focus) {
    const hops = drawnTrail(graph, id)
    for (const hop of hops) if (!focused.has(hop)) shown.add(hop)

    for (let at = 1; at < hops.length; at += 1) {
      const [from, to] = [hops[at - 1]!, hops[at]!]
      for (const edge of touching.get(to) ?? []) {
        if (across(edge, to) !== from || wires[edge.id] === 'bright') continue
        if (wires[edge.id] === 'folded') {
          unfold(to, from)
          unfold(from, to)
        }
        wires[edge.id] = 'near'
      }
    }
  }

  for (const node of graph.nodes) nodes[node.id] = focused.has(node.id) ? 'focus' : shown.has(node.id) ? 'neighbor' : 'background'
  return { nodes, wires, folded }
}

export function hoverLevels(graph: Wired, hovered: string | null): Levels<HoverLevel, HoverLevel> {
  const nodes: Record<string, HoverLevel> = {}
  const wires: Record<string, HoverLevel> = {}
  const lit = new Set<string>(hovered == null ? [] : [hovered])
  for (const edge of graph.edges) {
    const touches = hovered != null && (edge.from === hovered || edge.to === hovered)
    wires[edge.id] = hovered == null ? 'none' : touches ? 'lit' : 'dim'
    if (touches) lit.add(edge.from).add(edge.to)
  }
  for (const node of graph.nodes) nodes[node.id] = hovered == null ? 'none' : lit.has(node.id) ? 'lit' : 'dim'
  return { nodes, wires }
}

/**
 * What hover adds while a focus is held. Over the focus itself, where the pointer rests all the time, it adds nothing,
 * so the wires the focus folded stay folded. Over anything else it lights that node, its wires and its neighbors.
 */
export function hoverShown(hover: HoverLevel, hovered: string | null, focus: readonly string[]): HoverLevel {
  return hovered != null && focus.includes(hovered) ? 'none' : hover
}
