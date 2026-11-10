import type { ReviewEdge } from './types.ts'

export interface Ride {
  edge: ReviewEdge
  /** True when the wire is ridden against its direction, from its right end to its left end. */
  reversed: boolean
}

/**
 * The wire that joins one focus to the next, if there is one. A wire ridden in its own direction is
 * preferred, and among equals a wire the host derived comes before one the model proposed.
 */
export function connectingEdge(edges: readonly ReviewEdge[], from: readonly string[], to: readonly string[]): Ride | undefined {
  const left = new Set(from)
  const right = new Set(to)
  let best: (Ride & { rank: number }) | undefined
  for (const edge of edges) {
    const forward = left.has(edge.from) && right.has(edge.to)
    const backward = left.has(edge.to) && right.has(edge.from)
    if (!forward && !backward) continue
    const rank = (forward ? 0 : 2) + (edge.certainty === 'host' ? 0 : 1)
    if (!best || rank < best.rank) best = { edge, reversed: !forward, rank }
  }
  return best && { edge: best.edge, reversed: best.reversed }
}
