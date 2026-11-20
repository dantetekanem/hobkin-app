/**
 * Where each node of a picture sits, laid out by dagre (_specs/050-tla-proofs uses the libraries the review graph
 * already does). A move goes left to right, so a run reads in the order it happened; the machine by a variable reads
 * top to bottom. Actions that never fired join nothing, so they wait in a row under the graph. Pure, so the tests run
 * it with Node alone.
 */
import dagre from '@dagrejs/dagre'
import type { Picture } from './model.ts'

export interface Box {
  id: string
  width: number
  height: number
}

export interface Link {
  from: string
  to: string
  /** How hard dagre keeps it short and straight: the path's own wires pull hardest. */
  weight?: number
}

export interface Point {
  x: number
  y: number
}

export interface Spacing {
  /** Between two nodes of a column (a row, top to bottom). */
  nodesep: number
  /** Between columns (rows, top to bottom), where the action names sit. */
  ranksep: number
  /** Left to right, or top to bottom for the machine by a variable, whose few groups fit a wide canvas better so. */
  rankdir?: 'LR' | 'TB'
}

const DEFAULT: Spacing = { nodesep: 24, ranksep: 80 }

/** Each box's top-left corner. */
export function layOut(boxes: readonly Box[], links: readonly Link[], spacing: Spacing = DEFAULT): Map<string, Point> {
  const graph = new dagre.graphlib.Graph({ multigraph: true })
  graph.setGraph({ rankdir: spacing.rankdir ?? 'LR', nodesep: spacing.nodesep, ranksep: spacing.ranksep, marginx: 0, marginy: 0 })
  graph.setDefaultEdgeLabel(() => ({}))
  const known = new Set(boxes.map((box) => box.id))
  for (const box of boxes) graph.setNode(box.id, { width: box.width, height: box.height })
  links.forEach((link, index) => {
    if (link.from === link.to || !known.has(link.from) || !known.has(link.to)) return
    graph.setEdge(link.from, link.to, { weight: link.weight ?? 1, minlen: 1 }, String(index))
  })
  dagre.layout(graph)
  return new Map(
    boxes.map((box) => {
      const { x = 0, y = 0 } = graph.node(box.id) as { x?: number; y?: number }
      return [box.id, { x: x - box.width / 2, y: y - box.height / 2 }]
    }),
  )
}

/** Between two states of the path, where the action that leads from one to the next is named. */
const PATH_GAP = 92
/** How far a move the path did not take lands from it, above or below. */
const SIDE_RISE = 92

/**
 * The counterexample as the design draws it: its states on one straight line, in order, and each other move from a
 * state landing in the next column, above the line from one column and below it from the next, so they never meet.
 */
export function placePath(picture: Picture): Map<string, Point> {
  const placed = new Map<string, Point>()
  const steps = picture.nodes.filter((node) => node.look === 'step')
  const size = steps[0]?.width ?? 44
  const column = (index: number) => index * (size + PATH_GAP)
  for (const node of steps) placed.set(node.id, { x: column(node.step ?? 0), y: 0 })
  const byId = new Map(picture.nodes.map((node) => [node.id, node]))
  const filled = new Map<number, number>()
  for (const edge of picture.edges) {
    const side = byId.get(edge.to)
    if (edge.look !== 'side' || side?.look !== 'side' || placed.has(side.id)) continue
    const at = (byId.get(edge.from)?.step ?? 0) + 1
    const taken = filled.get(at) ?? 0
    filled.set(at, taken + 1)
    const above = taken % 2 === 0 ? at % 2 === 1 : at % 2 === 0
    const middle = size / 2 + (above ? -1 : 1) * SIDE_RISE * (Math.floor(taken / 2) + 1)
    placed.set(side.id, { x: column(at) + (size - side.width) / 2, y: middle - side.height / 2 })
  }
  return placed
}

/** The gap under the graph before the row of actions that never fired. */
const GHOST_GAP = 48

/** A whole picture: the graph by dagre, and the actions that never fired in a row under it. */
export function placePicture(picture: Picture, spacing: Spacing): Map<string, Point> {
  const ghosts = picture.nodes.filter((node) => node.look === 'ghost')
  const placed = layOut(
    picture.nodes.filter((node) => node.look !== 'ghost'),
    picture.edges.filter((edge) => !edge.loop).map((edge) => ({ from: edge.from, to: edge.to, weight: edge.look === 'path' ? 8 : 1 })),
    spacing,
  )
  if (ghosts.length === 0) return placed
  const boxes = picture.nodes.filter((node) => placed.has(node.id))
  const left = boxes.length > 0 ? Math.min(...boxes.map((node) => placed.get(node.id)!.x)) : 0
  const bottom = boxes.length > 0 ? Math.max(...boxes.map((node) => placed.get(node.id)!.y + node.height)) : 0
  let x = left
  for (const ghost of ghosts) {
    placed.set(ghost.id, { x, y: bottom + GHOST_GAP })
    x += ghost.width + 16
  }
  return placed
}
