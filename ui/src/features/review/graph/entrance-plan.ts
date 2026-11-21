/**
 * The order things arrive in when a review opens for the first time: spec, then tests, then code,
 * then context, with each wire drawing after the nodes it joins have landed.
 */
import type { ReviewEdge, ReviewNode } from '#shared/review/types.ts'

export interface EntrancePlan {
  /** Seconds each node waits before it rises into place. */
  nodes: Record<string, number>
  /** Seconds each wire waits before it draws. */
  wires: Record<string, number>
  /** Seconds until the last wire has drawn. */
  total: number
  /** A large graph only fades in, column by column, and draws no wire (spec 053). */
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

export function planEntrance(nodes: readonly Pick<ReviewNode, 'id' | 'position'>[], edges: readonly Pick<ReviewEdge, 'id' | 'from' | 'to'>[]): EntrancePlan {
  // Columns are told by where the nodes sit, so nodes the reviewer moved arrive with the column they are in now.
  const columns = [...new Set(nodes.map((node) => node.position.x))].sort((a, b) => a - b)
  const delays: Record<string, number> = {}
  for (const [column, x] of columns.entries()) {
    const rows = nodes.filter((node) => node.position.x === x).sort((a, b) => a.position.y - b.position.y)
    const step = Math.min(ENTRANCE.row, ENTRANCE.columnSpread / Math.max(1, rows.length - 1))
    rows.forEach((node, row) => (delays[node.id] = ENTRANCE.lead + column * ENTRANCE.column + row * step))
  }
  const quiet = nodes.length > QUIET_ENTRANCE_ABOVE
  const wires: Record<string, number> = {}
  let total = 0
  for (const edge of quiet ? [] : edges) {
    wires[edge.id] = Math.max(delays[edge.from] ?? 0, delays[edge.to] ?? 0) + ENTRANCE.afterNodes
    total = Math.max(total, wires[edge.id]! + ENTRANCE.draw)
  }
  return { nodes: delays, wires, total: Math.max(total, ...Object.values(delays)), quiet }
}
