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
function bandDepths(ids: readonly string[], edges: readonly LayoutEdge[], most = MAX_CODE_COLUMNS): Map<string, number> {
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
  for (const [id, value] of depth) depth.set(id, Math.min(value, most - 1))
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
  return { columns, tops: settleColumns(columns, edges) }
}

/** Packs every column on one line, then pulls each node toward what it is wired to, column by column, so wires run level. */
function settleColumns(columns: Column[], edges: readonly LayoutEdge[]): Map<string, number> {
  const nodes = columns.flatMap((column) => column.nodes)
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
  return tops
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

/** The kinds that are not on the way a request goes: they sit in the lane under it. */
const LANE_KINDS: ReadonlySet<NodeKind> = new Set(['test', 'criterion'])
/** Room between the way a request goes and the lane of tests under it. */
export const LANE_GAP = 140
/** Room between the ways a request enters by and the ways nothing enters, under them. */
export const LOOSE_GAP = 96
/** How far left of what it covers a node of the lane sits, so its wire rises to it from the left, and the room beside it. */
const LANE = { lead: 56, room: 40 } as const
/** Past this many columns along the way, a deeper node shares the last. */
export const MAX_WAY_COLUMNS = 8

/** A node as the request's layout needs it: whether it is where a request enters, and whether the change touched it. */
export type WayNode = LayoutNode & { entry?: unknown; change?: string }

/** The nodes wired together, each set apart from the rest, in the order their first node comes. */
function waysOf(nodes: readonly WayNode[], edges: readonly LayoutEdge[]): WayNode[][] {
  const root = new Map(nodes.map((node) => [node.id, node.id]))
  const find = (id: string): string => {
    const parent = root.get(id)!
    if (parent === id) return id
    const top = find(parent)
    root.set(id, top)
    return top
  }
  for (const edge of edges) if (root.has(edge.from) && root.has(edge.to)) root.set(find(edge.from), find(edge.to))
  const ways = new Map<string, WayNode[]>()
  for (const node of nodes) ways.set(find(node.id), [...(ways.get(find(node.id)) ?? []), node])
  return [...ways.values()]
}

/** Columns from depths, with files under the code of their column, shifted to start at a column. */
function columnsAt(nodes: readonly WayNode[], depth: ReadonlyMap<string, number>, start: number): { index: number; column: Column }[] {
  const columns: { index: number; column: Column }[] = []
  for (let level = 0; level <= Math.max(-1, ...nodes.map((node) => depth.get(node.id) ?? 0)); level += 1) {
    const atLevel = nodes.filter((node) => (depth.get(node.id) ?? 0) === level)
    if (atLevel.length > 0) columns.push({ index: start + level, column: { band: 'code', nodes: [...atLevel.filter((node) => node.kind !== 'file'), ...atLevel.filter((node) => node.kind === 'file')] } })
  }
  return columns
}

/**
 * The graph in the order a request goes through it (the user, 2026-11-12), left to right: where it enters (a route, a
 * job, a command), then the code that leads to the change, then the change, then what the change calls. Each node sits a
 * column after every node wired into it. Wires run as they are read: from the node on the left. A way no entry reaches,
 * such as a script or a file nothing calls, is not an entry: it starts at the column of the change, in a row of its own
 * under the ways a request enters, so the first column holds only where requests enter. Tests and acceptance lines are
 * not on any way: they sit in a lane under them all, each just left of what it covers, so its wire rises to it.
 */
export function layoutRequest(nodes: readonly WayNode[], edges: readonly LayoutEdge[]): Positions {
  const lane = nodes.filter((node) => LANE_KINDS.has(node.kind))
  const way = nodes.filter((node) => !LANE_KINDS.has(node.kind))
  const onWay = new Set(way.map((node) => node.id))
  const wayEdges = edges.filter((edge) => onWay.has(edge.from) && onWay.has(edge.to))
  const depth = bandDepths(way.map((node) => node.id), wayEdges, MAX_WAY_COLUMNS)
  const ways = waysOf(way, wayEdges)
  const entered = ways.filter((nodes) => nodes.some((node) => node.entry != null))
  const loose = ways.filter((nodes) => !entered.includes(nodes)).flat()
  const ofEntered = entered.flat()
  const changed = ofEntered.filter((node) => node.kind !== 'context' && node.change !== 'unchanged')
  // Ways nothing enters start where the change starts on the ways a request does, or a column in from where it enters.
  const start = ofEntered.length === 0 ? 0 : changed.length > 0 ? Math.min(...changed.map((node) => depth.get(node.id) ?? 0)) : 1

  const width = Math.max(...Object.values(NODE_SIZE).map((size) => size.width))
  const positions: Positions = {}
  let top = 0
  for (const [band, offset] of [[ofEntered, 0], [loose, start]] as const) {
    if (band.length === 0) continue
    const columns = columnsAt(band, depth, offset)
    const tops = settleColumns(columns.map((entry) => entry.column), wayEdges)
    const highest = Math.min(...tops.values())
    for (const { index, column } of columns) for (const node of column.nodes) positions[node.id] = { x: index * (width + COLUMN_GAP), y: Math.round(top + tops.get(node.id)! - highest) }
    top = Math.max(...band.map((node) => positions[node.id]!.y + NODE_SIZE[node.kind].height)) + LOOSE_GAP
  }

  if (lane.length > 0) {
    const bottom = way.length > 0 ? Math.max(...way.map((node) => positions[node.id]!.y + NODE_SIZE[node.kind].height)) : -LANE_GAP
    const leaving = (id: string) => edges.filter((edge) => edge.from === id && edge.to !== id).map((edge) => edge.to)
    // Each wants to stand just left of the leftmost thing it covers: a test, of its code; a line, of its test or code.
    const wanted = new Map<string, number>()
    const leftOf = (ids: readonly (number | undefined)[]) => {
      const xs = ids.filter((value): value is number => value != null)
      return xs.length > 0 ? Math.min(...xs) - width - LANE.lead : 0
    }
    for (const node of lane.filter((entry) => entry.kind === 'test')) wanted.set(node.id, leftOf(leaving(node.id).map((id) => positions[id]?.x)))
    for (const node of lane.filter((entry) => entry.kind === 'criterion')) wanted.set(node.id, leftOf(leaving(node.id).map((id) => positions[id]?.x ?? wanted.get(id))))
    // Then each takes the first row where it has room, in the order of where they want to be.
    const rows: [number, number][][] = []
    const rowHeight = Math.max(...lane.map((node) => NODE_SIZE[node.kind].height))
    const order = lane.map((node, index) => ({ node, index })).sort((a, b) => wanted.get(a.node.id)! - wanted.get(b.node.id)! || a.index - b.index)
    for (const { node } of order) {
      const left = wanted.get(node.id)!
      const right = left + NODE_SIZE[node.kind].width
      let row = 0
      while (rows[row]?.some(([from, to]) => left < to + LANE.room && from < right + LANE.room)) row += 1
      ;(rows[row] ??= []).push([left, right])
      positions[node.id] = { x: Math.round(left), y: Math.round(bottom + LANE_GAP + row * (rowHeight + ROW_GAP)) }
    }
  }

  // The whole graph starts at the origin.
  const placed = Object.values(positions)
  const [left, highest] = [Math.min(0, ...placed.map((point) => point.x)), Math.min(0, ...placed.map((point) => point.y))]
  for (const point of placed) {
    point.x -= left
    point.y -= highest
  }
  return positions
}

/** Room between two columns of an open block: its nodes are not wired to each other, so they stand closer. */
export const BLOCK_GAP = 48
/** An open block is at least this many rows tall before it takes a second column. */
const BLOCK_ROWS = 6

/** A node that opens into several, in place: it stays where it stands, at the block's top left, and they follow it. */
export interface Block {
  at: string
  /** What it opens to, in reading order: down each column, then on to the next column to the right. */
  ids: readonly string[]
}

/**
 * Opens blocks in place (spec 053, a group of a large change opened). Each block starts where its node stands and fills
 * its columns top to bottom, then left to right. What stands beside it on its right moves right by the block's extra
 * width, and what stands below it moves down by its extra height, so nothing overlaps and the graph still reads left to
 * right. Every node is as wide as every other (`NODE_SIZE`), which is what keeps the moves apart.
 */
export function openBlocks(positions: Positions, kindOf: (id: string) => NodeKind, blocks: readonly Block[]): Positions {
  const placed: Positions = Object.fromEntries(Object.entries(positions).map(([id, point]) => [id, { ...point }]))
  const width = Math.max(...Object.values(NODE_SIZE).map((size) => size.width))
  const height = Math.max(...Object.values(NODE_SIZE).map((size) => size.height))
  for (const { at, ids } of blocks) {
    const origin = placed[at]
    if (!origin || ids.length === 0) continue
    // The node itself holds the block's first cell, and what it opens to the rest.
    const cells = ids.length + 1
    const rows = Math.min(cells, Math.max(BLOCK_ROWS, Math.ceil(Math.sqrt(cells))))
    const columns = Math.ceil(cells / rows)
    const own = NODE_SIZE[kindOf(at)].height
    const wider = (columns - 1) * (width + BLOCK_GAP)
    const taller = rows * height + (rows - 1) * ROW_GAP - own
    const { x, y } = origin
    for (const [id, point] of Object.entries(placed)) {
      if (id === at) continue
      if (point.y >= y + own) point.y += taller
      else if (point.x > x) point.x += wider
    }
    ids.forEach((id, index) => {
      const cell = index + 1
      const column = Math.floor(cell / rows)
      const row = cell % rows
      placed[id] = { x: x + column * (width + BLOCK_GAP), y: y + row * (height + ROW_GAP) }
    })
  }
  return placed
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
