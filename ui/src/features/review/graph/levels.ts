/**
 * How present each node and wire is, given what is focused and what the pointer is over.
 * Pure, so the levels of a step can be tested without drawing anything.
 */
import type { ReviewEdge } from '#shared/review/types.ts'

/**
 * `rest`: nothing is focused, the whole graph is shown.
 * `focus`: sharp, with an accent ring. `neighbor`: wired to a focus node, dimmed and sharp.
 * `background`: everything else, blurred and faded.
 */
export type NodeLevel = 'rest' | 'focus' | 'neighbor' | 'background'
/** `bright` wires touch the focus. With a focus, the others are `faded`. */
export type WireLevel = 'rest' | 'bright' | 'faded'
/** `lit` is the hovered node, its wires and its neighbors. `dim` is everything else while something is hovered. */
export type HoverLevel = 'none' | 'lit' | 'dim'

export interface Graph {
  nodes: readonly { id: string }[]
  edges: readonly Pick<ReviewEdge, 'id' | 'from' | 'to'>[]
}

export interface Levels<NodeValue, WireValue> {
  nodes: Record<string, NodeValue>
  wires: Record<string, WireValue>
}

export function focusLevels(graph: Graph, focus: readonly string[]): Levels<NodeLevel, WireLevel> {
  const focused = new Set(focus)
  const nodes: Record<string, NodeLevel> = {}
  const wires: Record<string, WireLevel> = {}
  if (focused.size === 0) {
    for (const node of graph.nodes) nodes[node.id] = 'rest'
    for (const edge of graph.edges) wires[edge.id] = 'rest'
    return { nodes, wires }
  }
  const near = new Set<string>()
  for (const edge of graph.edges) {
    const touches = focused.has(edge.from) || focused.has(edge.to)
    wires[edge.id] = touches ? 'bright' : 'faded'
    if (touches) near.add(edge.from).add(edge.to)
  }
  for (const node of graph.nodes) nodes[node.id] = focused.has(node.id) ? 'focus' : near.has(node.id) ? 'neighbor' : 'background'
  return { nodes, wires }
}

export function hoverLevels(graph: Graph, hovered: string | null): Levels<HoverLevel, HoverLevel> {
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
