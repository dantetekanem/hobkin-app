/**
 * The shape of a wire: a smooth curve that leaves its source to the right and arrives at its target from the left,
 * as wires do in Unreal Engine's Blueprints. On a graph that reads top to bottom it is the same curve turned: it leaves
 * downward and arrives from above. The wire component draws it and the camera rides it, so both read the curve from here.
 */
import type { GraphFlow, Point } from '#shared/review/layout.ts'

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

const turn = ({ x, y }: Point): Point => ({ x: y, y: x })

export function wireCurve(source: Point, target: Point, flow: GraphFlow = 'left-to-right'): WireCurve {
  const down = flow === 'top-to-bottom'
  const offset = down ? reach(turn(source), turn(target)) : reach(source, target)
  const [one, two] = down
    ? [{ x: source.x, y: source.y + offset }, { x: target.x, y: target.y - offset }]
    : [{ x: source.x + offset, y: source.y }, { x: target.x - offset, y: target.y }]
  const pointAt = (t: number): Point => {
    const u = 1 - t
    const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
    return { x: a * source.x + b * one.x + c * two.x + d * target.x, y: a * source.y + b * one.y + c * two.y + d * target.y }
  }
  return {
    d: `M${source.x} ${source.y}C${one.x} ${one.y} ${two.x} ${two.y} ${target.x} ${target.y}`,
    pointAt,
    middle: pointAt(0.5),
  }
}
