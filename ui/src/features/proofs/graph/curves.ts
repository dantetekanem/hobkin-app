/**
 * The shape of a move on the state graph. Left to right, it leaves its state on the right and arrives at the next on the
 * left, as the review graph's wires do; a move back to an earlier column dips under the states between, and a move that
 * keeps its state loops over it. Top to bottom, it leaves from the bottom and arrives at the top, a move back bulges to
 * the right, and a move that keeps the grouped value loops out of the node's right side and back. Pure.
 */
import type { Point } from './layout.ts'

export interface Curve {
  /** For an SVG `d` attribute. */
  d: string
  /** A point on the curve: 0 is where it leaves, 1 where it arrives. */
  at(t: number): Point
  /** Which way it points as it arrives, in radians. */
  heading: number
}

function cubic(start: Point, one: Point, two: Point, end: Point): Curve {
  const at = (t: number): Point => {
    const u = 1 - t
    const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
    return { x: a * start.x + b * one.x + c * two.x + d * end.x, y: a * start.y + b * one.y + c * two.y + d * end.y }
  }
  // At the end a cubic points from its second control point; when they meet, from the first.
  const from = two.x === end.x && two.y === end.y ? one : two
  return { d: `M${start.x} ${start.y}C${one.x} ${one.y} ${two.x} ${two.y} ${end.x} ${end.y}`, at, heading: Math.atan2(end.y - from.y, end.x - from.x) }
}

/** How far a loop rises over its node. */
const LOOP = 62

export interface Bend {
  loop?: boolean
  /** Top to bottom: the handles are at the bottom (source) and top (target). */
  vertical?: boolean
  /** The node's width, for a loop on its side. */
  width?: number
}

function verticalCurve(source: Point, target: Point, { loop, width = 0 }: Bend): Curve {
  if (loop) {
    // The node's right edge, at its middle: the handles are the middles of its bottom and top.
    const [right, middle] = [source.x + width / 2, (source.y + target.y) / 2]
    return cubic({ x: right, y: middle - 9 }, { x: right + 58, y: middle - 44 }, { x: right + 58, y: middle + 44 }, { x: right + 1, y: middle + 9 })
  }
  const run = target.y - source.y
  if (run >= 0) {
    const reach = Math.max(run * 0.5, 24)
    return cubic(source, { x: source.x, y: source.y + reach }, { x: target.x, y: target.y - reach }, target)
  }
  const bulge = 70 + Math.min(120, -run * 0.12)
  return cubic(source, { x: Math.max(source.x, target.x) + bulge, y: source.y + 60 }, { x: Math.max(source.x, target.x) + bulge, y: target.y - 60 }, target)
}

export function moveCurve(source: Point, target: Point, bend: Bend = {}): Curve {
  if (bend.vertical) return verticalCurve(source, target, bend)
  if (bend.loop) return cubic(source, { x: source.x + 40, y: source.y - LOOP * 1.3 }, { x: target.x - 40, y: target.y - LOOP * 1.3 }, target)
  const run = target.x - source.x
  if (run >= 0) {
    const reach = Math.max(run * 0.5, 24)
    return cubic(source, { x: source.x + reach, y: source.y }, { x: target.x - reach, y: target.y }, target)
  }
  const dip = 56 + Math.min(120, -run * 0.12)
  return cubic(source, { x: source.x + 70, y: Math.max(source.y, target.y) + dip }, { x: target.x - 70, y: Math.max(source.y, target.y) + dip }, target)
}
