/**
 * Moving the focus from node to node with the keyboard: the nearest node in the direction pressed.
 * Tab belongs to the frame, so inside the graph the arrows walk it, as they walk a terminal's panes.
 */
import { NODE_SIZE, type GraphFlow } from '#shared/review/layout.ts'
import type { ReviewEdge, ReviewNode } from '#shared/review/types.ts'

export type Direction = 'up' | 'down' | 'left' | 'right'

type Placed = Pick<ReviewNode, 'id' | 'kind' | 'position'>

const middle = (node: Placed) => ({ x: node.position.x + NODE_SIZE[node.kind].width / 2, y: node.position.y + NODE_SIZE[node.kind].height / 2 })

/**
 * The arrow that does on a graph of `flow` what `direction` does on the graph that reads left to right, and the other
 * way round. Top to bottom turns the graph over its diagonal, and its arrows with it: Down does what Right does (the next
 * step, along a wire this node sends), Up what Left does, and Right and Left what Down and Up do (the node beside).
 */
export function turnedArrow(direction: Direction, flow: GraphFlow): Direction {
  return flow === 'top-to-bottom' ? TURNED[direction] : direction
}
const TURNED: Record<Direction, Direction> = { right: 'down', down: 'right', left: 'up', up: 'left' }

/**
 * The order a graph of `flow` is read in: column by column from the left, each from its top, or on a graph that reads
 * top to bottom, row by row from the top, each from its left.
 */
export function readingOrder(flow: GraphFlow): (a: Pick<ReviewNode, 'position'>, b: Pick<ReviewNode, 'position'>) => number {
  if (flow === 'top-to-bottom') return (a, b) => a.position.y - b.position.y || a.position.x - b.position.x
  return (a, b) => a.position.x - b.position.x || a.position.y - b.position.y
}

/** An arrow as the review's keys and hints show it. */
export const ARROW: Record<Direction, string> = { up: '↑', down: '↓', left: '←', right: '→' }

/**
 * The node to move to, or null at the edge of the graph. With no node to start from, the walk starts at the
 * top left, which is the first acceptance line when there is a spec: the first node the graph is read from.
 */
export function nodeToward(nodes: readonly Placed[], from: string | null, direction: Direction, flow: GraphFlow = 'left-to-right'): string | null {
  const start = nodes.find((node) => node.id === from)
  if (!start) return [...nodes].sort(readingOrder(flow))[0]?.id ?? null
  const here = middle(start)
  const along = direction === 'up' || direction === 'down' ? 'y' : 'x'
  const across = along === 'y' ? 'x' : 'y'
  const sign = direction === 'down' || direction === 'right' ? 1 : -1
  let best: { id: string; cost: number } | null = null
  for (const node of nodes) {
    if (node === start) continue
    const there = middle(node)
    const forward = (there[along] - here[along]) * sign
    const sideways = Math.abs(there[across] - here[across])
    // Only what lies in the direction pressed, and more ahead than aside, so Up never jumps a column.
    if (forward <= 1 || sideways > forward * 1.5) continue
    const cost = forward + sideways * 2
    if (!best || cost < best.cost) best = { id: node.id, cost }
  }
  return best?.id ?? null
}

/**
 * The node at the other end of a wire: to the right, a wire this node sends, and to the left, a wire it
 * receives. Of several, the one nearest in height, or on a graph that reads top to bottom, nearest across. Null when no
 * wire leaves that side.
 */
export function nodeAlongWire(nodes: readonly Placed[], edges: readonly Pick<ReviewEdge, 'from' | 'to'>[], from: string, direction: 'left' | 'right', flow: GraphFlow = 'left-to-right'): string | null {
  const start = nodes.find((node) => node.id === from)
  if (!start) return null
  const ends = edges.filter((edge) => (direction === 'right' ? edge.from === from : edge.to === from)).map((edge) => (direction === 'right' ? edge.to : edge.from))
  const here = middle(start)
  const [aside, ahead] = flow === 'left-to-right' ? (['y', 'x'] as const) : (['x', 'y'] as const)
  let best: { id: string; cost: number } | null = null
  for (const id of new Set(ends)) {
    const node = nodes.find((entry) => entry.id === id)
    if (!node || node.id === from) continue
    const there = middle(node)
    const cost = Math.abs(there[aside] - here[aside]) * 4 + Math.abs(there[ahead] - here[ahead])
    if (!best || cost < best.cost) best = { id, cost }
  }
  return best?.id ?? null
}
