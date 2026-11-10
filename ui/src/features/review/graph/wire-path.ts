/**
 * The shape of a wire: a smooth curve that leaves its source to the right and arrives at its target from the left,
 * as wires do in Unreal Engine's Blueprints. The wire component draws it and the camera rides it, so both read
 * the curve from here.
 */
import type { Point } from '#shared/review/layout.ts'

export interface WireCurve {
  /** The path, for an SVG `d` attribute. */
  d: string
  /** A point on the wire. 0 is the source pin and 1 is the target pin. */
  pointAt(t: number): Point
  /** The middle of the wire, where its label sits. */
  middle: Point
}

/** How far the curve keeps going level before it turns. A wire that has to come back loops wider. */
function reach(source: Point, target: Point): number {
  const run = target.x - source.x
  if (run >= 0) return Math.max(run * 0.5, Math.min(72, 24 + Math.abs(target.y - source.y) * 0.25))
  return Math.min(320, 96 + Math.sqrt(-run) * 6)
}

export function wireCurve(source: Point, target: Point): WireCurve {
  const offset = reach(source, target)
  const [c1x, c2x] = [source.x + offset, target.x - offset]
  const pointAt = (t: number): Point => {
    const u = 1 - t
    const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
    return { x: a * source.x + b * c1x + c * c2x + d * target.x, y: a * source.y + b * source.y + c * target.y + d * target.y }
  }
  return {
    d: `M${source.x} ${source.y}C${c1x} ${source.y} ${c2x} ${target.y} ${target.x} ${target.y}`,
    pointAt,
    middle: pointAt(0.5),
  }
}
