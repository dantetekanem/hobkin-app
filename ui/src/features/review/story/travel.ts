/**
 * How the camera gets from one focus to the next: along the wire that joins them, or straight when none does.
 */
import { NODE_SIZE, type Point } from '#shared/review/layout.ts'
import { connectingEdge } from '#shared/review/story.ts'
import type { ReviewEdge, ReviewNode } from '#shared/review/types.ts'
import type { WireCurve } from '../graph/wire-path.ts'

export interface Travel {
  /** The id of the wire ridden. */
  wire: string
  /** True when it is ridden against its direction, from its right end to its left. */
  reversed: boolean
}

/**
 * The wire to ride from one focus to another, or null for a straight glide. `preferred` is the wire the review
 * file names for the step, used when it does join the two.
 */
export function pickTravel(edges: readonly ReviewEdge[], from: readonly string[], to: readonly string[], preferred?: string): Travel | null {
  if (from.length === 0 || to.length === 0) return null
  // Moving within the same focus is not a trip.
  if (from.length === to.length && from.every((id) => to.includes(id))) return null
  const named = preferred ? edges.find((edge) => edge.id === preferred) : undefined
  const ride = (named && connectingEdge([named], from, to)) ?? connectingEdge(edges, from, to)
  return ride ? { wire: ride.edge.id, reversed: ride.reversed } : null
}

type Placed = Pick<ReviewNode, 'id' | 'kind' | 'position'>

/** The two pins of a wire: the middle of the right edge of its source and of the left edge of its target. */
export function wireEnds(edge: Pick<ReviewEdge, 'from' | 'to'>, nodes: readonly Placed[]): { source: Point; target: Point } {
  const from = nodes.find((node) => node.id === edge.from)!
  const to = nodes.find((node) => node.id === edge.to)!
  return {
    source: { x: from.position.x + NODE_SIZE[from.kind].width, y: from.position.y + NODE_SIZE[from.kind].height / 2 },
    target: { x: to.position.x, y: to.position.y + NODE_SIZE[to.kind].height / 2 },
  }
}

/**
 * How far off the straight line the camera is at progress `p` of a ride, so that it follows the wire's bend
 * and still starts and lands exactly where its framing says. Nothing for a glide.
 */
export function rideOffset(curve: WireCurve | null, reversed: boolean, p: number): Point {
  if (!curve || p <= 0 || p >= 1) return { x: 0, y: 0 }
  const at = (t: number) => curve.pointAt(reversed ? 1 - t : t)
  const [start, end, here] = [at(0), at(1), at(p)]
  return { x: here.x - (start.x + (end.x - start.x) * p), y: here.y - (start.y + (end.y - start.y) * p) }
}

/** Where the pulse is on the wire at progress `p` of a ride. */
export function pulsePoint(curve: WireCurve, reversed: boolean, p: number): Point {
  return curve.pointAt(reversed ? 1 - p : p)
}
