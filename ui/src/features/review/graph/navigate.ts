/**
 * Moving the focus from node to node with the keyboard: the nearest node in the direction pressed.
 * Tab belongs to the frame, so inside the graph the arrows walk it, as they walk a terminal's panes.
 */
import { NODE_SIZE } from '#shared/review/layout.ts'
import type { ReviewEdge, ReviewNode } from '#shared/review/types.ts'

export type Direction = 'up' | 'down' | 'left' | 'right'

type Placed = Pick<ReviewNode, 'id' | 'kind' | 'position'>

const middle = (node: Placed) => ({ x: node.position.x + NODE_SIZE[node.kind].width / 2, y: node.position.y + NODE_SIZE[node.kind].height / 2 })

/**
 * The node to move to, or null at the edge of the graph. With no node to start from, the walk starts at the
 * top left, which is the first acceptance line when there is a spec.
 */
export function nodeToward(nodes: readonly Placed[], from: string | null, direction: Direction): string | null {
  const start = nodes.find((node) => node.id === from)
  if (!start) {
    const first = [...nodes].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)[0]
    return first?.id ?? null
  }
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
 * receives. Of several, the one nearest in height. Null when no wire leaves that side.
 */
export function nodeAlongWire(nodes: readonly Placed[], edges: readonly Pick<ReviewEdge, 'from' | 'to'>[], from: string, direction: 'left' | 'right'): string | null {
  const start = nodes.find((node) => node.id === from)
  if (!start) return null
  const ends = edges.filter((edge) => (direction === 'right' ? edge.from === from : edge.to === from)).map((edge) => (direction === 'right' ? edge.to : edge.from))
  const here = middle(start)
  let best: { id: string; cost: number } | null = null
  for (const id of new Set(ends)) {
    const node = nodes.find((entry) => entry.id === id)
    if (!node || node.id === from) continue
    const there = middle(node)
    const cost = Math.abs(there.y - here.y) * 4 + Math.abs(there.x - here.x)
    if (!best || cost < best.cost) best = { id, cost }
  }
  return best?.id ?? null
}
