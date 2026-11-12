/**
 * Where each node sits on the graph. Columns run left to right: spec, tests, code, context.
 *
 * The layout is computed once when a review is prepared and saved in the review file,
 * so a review looks the same every time it opens. Nothing here is random.
 */
import type { NodeKind } from './types.ts'

/** The size a node card is drawn at. The layout and the card share these numbers, so cards never overlap. */
export const NODE_SIZE: Record<NodeKind, { width: number; height: number }> = {
  criterion: { width: 288, height: 136 },
  test: { width: 288, height: 136 },
  code: { width: 288, height: 136 },
  file: { width: 288, height: 120 },
  context: { width: 288, height: 120 },
}

/** Room between columns, where wires curve. */
export const COLUMN_GAP = 132
/** Room between two nodes of a column. */
export const ROW_GAP = 28
/**
 * Code that calls code sits a column to its left, and context a caller calls sits a column to the caller's left, so
 * the way out to where a request enters reads across. Past this many columns, deeper nodes share the band's last one.
 */
export const MAX_CODE_COLUMNS = 4

export type Band = 'spec' | 'tests' | 'code' | 'context'

export interface LayoutNode {
  id: string
  kind: NodeKind
}

export interface LayoutEdge {
  from: string
  to: string
}

export interface Point {
  x: number
  y: number
}

export interface Rect extends Point {
  width: number
  height: number
}

export type Positions = Record<string, Point>

const BAND_OF: Record<NodeKind, Band> = { criterion: 'spec', test: 'tests', code: 'code', file: 'code', context: 'context' }
const BAND_ORDER: readonly Band[] = ['spec', 'tests', 'code', 'context']

export function bandOf(kind: NodeKind): Band {
  return BAND_OF[kind]
}

export function nodeRect(kind: NodeKind, position: Point): Rect {
  return { x: position.x, y: position.y, ...NODE_SIZE[kind] }
}

/** Where a wire leaves and arrives: the middle of the right edge of `from`, the middle of the left edge of `to`. */
export function pinPoints(edge: LayoutEdge, nodes: readonly LayoutNode[], positions: Positions): { source: Point; target: Point } {
  const from = nodes.find((node) => node.id === edge.from)!
  const to = nodes.find((node) => node.id === edge.to)!
  const start = positions[from.id]!
  const end = positions[to.id]!
  return {
    source: { x: start.x + NODE_SIZE[from.kind].width, y: start.y + NODE_SIZE[from.kind].height / 2 },
    target: { x: end.x, y: end.y + NODE_SIZE[to.kind].height / 2 },
  }
}

/**
 * How many columns to the right of its band's first column each node of a band sits: the longest chain of
 * wires that leads to it from other nodes of the band. A cycle is cut where a depth-first walk closes it.
 */
function bandDepths(ids: readonly string[], edges: readonly LayoutEdge[]): Map<string, number> {
  const inBand = new Set(ids)
  const next = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const edge of edges) {
    if (edge.from !== edge.to && inBand.has(edge.from) && inBand.has(edge.to)) next.get(edge.from)!.push(edge.to)
  }

  const state = new Map<string, 'open' | 'done'>()
  const cut = new Set<string>()
  const finished: string[] = []
  const walk = (id: string) => {
    state.set(id, 'open')
    for (const target of next.get(id)!) {
      if (!state.has(target)) walk(target)
      else if (state.get(target) === 'open') cut.add(`${id}>${target}`)
    }
    state.set(id, 'done')
    finished.push(id)
  }
  for (const id of ids) if (!state.has(id)) walk(id)

  const depth = new Map<string, number>(ids.map((id) => [id, 0]))
  for (const id of finished.reverse()) {
    for (const target of next.get(id)!) {
      if (!cut.has(`${id}>${target}`)) depth.set(target, Math.max(depth.get(target)!, depth.get(id)! + 1))
    }
  }
  for (const [id, value] of depth) depth.set(id, Math.min(value, MAX_CODE_COLUMNS - 1))
  return depth
}

interface Column {
  band: Band
  nodes: LayoutNode[]
}

/** The nodes of each column in their starting order: as given, with files under the code of their column. */
function startingColumns(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): Column[] {
  const columns: Column[] = []
  for (const band of BAND_ORDER) {
    const members = nodes.filter((node) => BAND_OF[node.kind] === band)
    if (members.length === 0) continue
    if (band !== 'code' && band !== 'context') {
      columns.push({ band, nodes: members })
      continue
    }
    const depth = bandDepths(members.map((node) => node.id), edges)
    const deepest = Math.max(...depth.values())
    for (let level = 0; level <= deepest; level += 1) {
      const atLevel = members.filter((node) => depth.get(node.id) === level)
      if (atLevel.length > 0) columns.push({ band, nodes: [...atLevel.filter((node) => node.kind !== 'file'), ...atLevel.filter((node) => node.kind === 'file')] })
    }
  }
  return columns
}

/**
 * The tops closest to the wanted ones that keep the given order and never overlap.
 * This is least squares under an ordering constraint, solved by pooling neighbors that would cross.
 */
function settle(wantedTops: readonly number[], heights: readonly number[]): number[] {
  // Measure each node from where it would sit if the column were packed tight. The constraint is then "never decreasing".
  const packed: number[] = []
  let offset = 0
  for (const height of heights) {
    packed.push(offset)
    offset += height + ROW_GAP
  }
  const blocks: { sum: number; count: number }[] = []
  wantedTops.forEach((top, index) => {
    blocks.push({ sum: top - packed[index]!, count: 1 })
    while (blocks.length > 1 && blocks.at(-2)!.sum / blocks.at(-2)!.count > blocks.at(-1)!.sum / blocks.at(-1)!.count) {
      const last = blocks.pop()!
      blocks.at(-1)!.sum += last.sum
      blocks.at(-1)!.count += last.count
    }
  })
  const tops: number[] = []
  for (const block of blocks) for (let index = 0; index < block.count; index += 1) tops.push(block.sum / block.count + packed[tops.length]!)
  return tops
}

interface Placed {
  columns: Column[]
  tops: Map<string, number>
}

function place(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): Placed {
  const columns = startingColumns(nodes, edges)
  const columnOf = new Map<string, number>()
  columns.forEach((column, index) => column.nodes.forEach((node) => columnOf.set(node.id, index)))
  const kindOf = new Map(nodes.map((node) => [node.id, node.kind]))
  const neighbors = new Map<string, string[]>(nodes.map((node) => [node.id, []]))
  for (const edge of edges) {
    if (edge.from === edge.to || !columnOf.has(edge.from) || !columnOf.has(edge.to)) continue
    neighbors.get(edge.from)!.push(edge.to)
    neighbors.get(edge.to)!.push(edge.from)
  }

  const tops = new Map<string, number>()
  const middle = (id: string) => tops.get(id)! + NODE_SIZE[kindOf.get(id)!].height / 2

  // Start with every column packed and centered on the same line.
  for (const column of columns) {
    const total = column.nodes.reduce((sum, node) => sum + NODE_SIZE[node.kind].height + ROW_GAP, -ROW_GAP)
    let top = -total / 2
    for (const node of column.nodes) {
      tops.set(node.id, top)
      top += NODE_SIZE[node.kind].height + ROW_GAP
    }
  }

  // Pull each node toward the nodes it is wired to, one column at a time, so wires run as level as they can.
  const sweep = (index: number, counts: (other: number) => boolean) => {
    const column = columns[index]!
    const wanted = new Map<string, number>()
    for (const node of column.nodes) {
      const pulls = neighbors.get(node.id)!.filter((id) => counts(columnOf.get(id)!)).map(middle)
      wanted.set(node.id, pulls.length > 0 ? pulls.reduce((sum, value) => sum + value, 0) / pulls.length : middle(node.id))
    }
    // Acceptance lines stay in the order the spec wrote them. Every other column is sorted to untangle its wires.
    const order =
      column.band === 'spec'
        ? column.nodes
        : column.nodes
            .map((node, position) => ({ node, position }))
            .sort((a, b) => Number(a.node.kind === 'file') - Number(b.node.kind === 'file') || wanted.get(a.node.id)! - wanted.get(b.node.id)! || a.position - b.position)
            .map((entry) => entry.node)
    column.nodes = order
    const settled = settle(
      order.map((node) => wanted.get(node.id)! - NODE_SIZE[node.kind].height / 2),
      order.map((node) => NODE_SIZE[node.kind].height),
    )
    order.forEach((node, position) => tops.set(node.id, settled[position]!))
  }

  for (let index = 1; index < columns.length; index += 1) sweep(index, (other) => other < index)
  for (let index = columns.length - 2; index >= 0; index -= 1) sweep(index, (other) => other > index)
  for (let index = 0; index < columns.length; index += 1) sweep(index, (other) => other !== index)
  return { columns, tops }
}

/** The columns of a review, left to right, each with its nodes from top to bottom. */
export function columnsOf(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): { band: Band; ids: string[] }[] {
  return place(nodes, edges).columns.map((column) => ({ band: column.band, ids: column.nodes.map((node) => node.id) }))
}

/** The top left corner of every node, with the whole graph starting at the origin. */
export function layoutReview(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): Positions {
  const { columns, tops } = place(nodes, edges)
  if (tops.size === 0) return {}
  const highest = Math.min(...tops.values())
  const positions: Positions = {}
  let x = 0
  for (const column of columns) {
    for (const node of column.nodes) positions[node.id] = { x, y: Math.round(tops.get(node.id)! - highest) }
    x += Math.max(...column.nodes.map((node) => NODE_SIZE[node.kind].width)) + COLUMN_GAP
  }
  return positions
}

/** Room between the bottom of the flow and the nodes set apart under it, where the block's label reads. */
export const APART_GAP = 120
/** Room between two nodes side by side in the block apart, and the most it holds in one row. */
const APART = { gap: 40, perRow: 4 } as const

/** Where every node sits, and the block of nodes nothing wires, with the box around it for its label. */
export interface GraphLayout {
  positions: Positions
  apart: { ids: string[]; box: Rect } | null
}

/**
 * The graph as it is drawn (the user, 2026-11-12: "many nodes also doesn't connect"): every wired node in the flow of
 * its columns, as `layoutReview` places them, and the nodes nothing wires in a compact block under it, out of its way,
 * in rows as wide as the flow. An acceptance line stays in the spec's column even when nothing proves it: an unproven
 * promise belongs with the others.
 */
export function layoutGraph(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): GraphLayout {
  const wired = new Set(edges.filter((edge) => edge.from !== edge.to).flatMap((edge) => [edge.from, edge.to]))
  const alone = nodes.filter((node) => node.kind !== 'criterion' && !wired.has(node.id))
  if (alone.length === 0) return { positions: layoutReview(nodes, edges), apart: null }

  const flow = nodes.filter((node) => !alone.includes(node))
  const positions = layoutReview(flow, edges)
  const width = Math.max(...Object.values(NODE_SIZE).map((size) => size.width))
  const flowBox = boundsOf(flow.map((node) => nodeRect(node.kind, positions[node.id]!)))
  const across = flow.length > 0 ? Math.floor((flowBox.width + APART.gap) / (width + APART.gap)) : APART.perRow
  const perRow = Math.max(1, Math.min(APART.perRow, alone.length, across))
  const top = flow.length > 0 ? flowBox.y + flowBox.height + APART_GAP : 0
  let y = top
  for (let start = 0; start < alone.length; start += perRow) {
    const row = alone.slice(start, start + perRow)
    row.forEach((node, index) => (positions[node.id] = { x: index * (width + APART.gap), y }))
    y += Math.max(...row.map((node) => NODE_SIZE[node.kind].height)) + ROW_GAP
  }
  const box = boundsOf(alone.map((node) => nodeRect(node.kind, positions[node.id]!)))
  return { positions, apart: { ids: alone.map((node) => node.id), box } }
}

/** The box around a set of nodes. */
export function boundsOf(rects: readonly Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}
