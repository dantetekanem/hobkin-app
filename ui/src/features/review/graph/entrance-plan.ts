/**
 * The order things arrive in when a review opens for the first time: zone by zone (spec 055), each zone's region with
 * its first node and its columns from left to right, with each wire drawing after the nodes it joins have landed. On a
 * graph that reads top to bottom its ranks are rows, and they arrive from the top.
 */
import type { GraphFlow, Point } from '#shared/review/layout.ts'
import type { ReviewEdge, ReviewNode } from '#shared/review/types.ts'

export interface EntrancePlan {
  /** Seconds each node waits before it rises into place. */
  nodes: Record<string, number>
  /** Seconds each wire waits before it draws. */
  wires: Record<string, number>
  /** Seconds each zone's region waits before it fades in: when its first node starts. */
  zones: Record<string, number>
  /** Seconds until the last wire has drawn. */
  total: number
  /** A large graph only fades in, zone by zone, and draws no wire (spec 053). */
  quiet: boolean
}

/** Past this many cards the entrance only fades the nodes in, and the wires are simply there. */
export const QUIET_ENTRANCE_ABOVE = 40

export const ENTRANCE = {
  /** The screen itself is still arriving, so the first column waits for it. */
  lead: 0.34,
  /** Between one column and the next. */
  column: 0.17,
  /** Between two nodes of a column. A long column shares `columnSpread` so it does not take all day. */
  row: 0.055,
  columnSpread: 0.36,
  /** A wire waits this long after the later of its two nodes started, so it draws onto a landed node. */
  afterNodes: 0.34,
  /** How long a wire takes to draw. */
  draw: 0.5,
} as const

type Arriving = Pick<ReviewNode, 'id' | 'position'> & Partial<Pick<ReviewNode, 'zone'>>

export function planEntrance(nodes: readonly Arriving[], edges: readonly Pick<ReviewEdge, 'id' | 'from' | 'to'>[], flow: GraphFlow = 'left-to-right'): EntrancePlan {
  // Where a node stands as the graph is read: `x` along it, rank by rank, and `y` across a rank.
  const at = (node: Arriving): Point => (flow === 'top-to-bottom' ? { x: node.position.y, y: node.position.x } : node.position)
  // Zones arrive in the order they stand, from the left and then from the top, so a zone of tests under its code comes
  // after it. Columns are told by where the nodes sit, so nodes the reviewer moved arrive with the column they are in now.
  const byZone = new Map<string, Arriving[]>()
  for (const node of nodes) byZone.set(node.zone ?? '', [...(byZone.get(node.zone ?? '') ?? []), node])
  const corner = (members: readonly Arriving[]) => [Math.min(...members.map((node) => at(node).x)), Math.min(...members.map((node) => at(node).y))] as const
  const zones = [...byZone].sort(([, a], [, b]) => corner(a)[0] - corner(b)[0] || corner(a)[1] - corner(b)[1])

  const delays: Record<string, number> = {}
  const starts: Record<string, number> = {}
  let column = 0
  for (const [zone, members] of zones) {
    const columns = [...new Set(members.map((node) => at(node).x))].sort((a, b) => a - b)
    starts[zone] = ENTRANCE.lead + column * ENTRANCE.column
    for (const x of columns) {
      const rows = members.filter((node) => at(node).x === x).sort((a, b) => at(a).y - at(b).y)
      const step = Math.min(ENTRANCE.row, ENTRANCE.columnSpread / Math.max(1, rows.length - 1))
      rows.forEach((node, row) => (delays[node.id] = ENTRANCE.lead + column * ENTRANCE.column + row * step))
      column += 1
    }
  }
  const quiet = nodes.length > QUIET_ENTRANCE_ABOVE
  const wires: Record<string, number> = {}
  let total = 0
  for (const edge of quiet ? [] : edges) {
    wires[edge.id] = Math.max(delays[edge.from] ?? 0, delays[edge.to] ?? 0) + ENTRANCE.afterNodes
    total = Math.max(total, wires[edge.id]! + ENTRANCE.draw)
  }
  const { '': _loose, ...regions } = starts
  return { nodes: delays, wires, zones: regions, total: Math.max(total, ...Object.values(delays)), quiet }
}
