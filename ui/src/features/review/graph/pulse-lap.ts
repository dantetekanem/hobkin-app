/**
 * The lap the pulse runs along an active wire, as keyframes for an HTML dot. Moving a box's transform lets the
 * compositor run the loop; SVG's `animateMotion`, which the wire used before, runs on the page's main thread every
 * frame (spec 052, S8). Pure, so the pace is tested without a window.
 */
import type { Point } from '#shared/review/layout.ts'

/** How many points of the wire a lap passes. Between two it goes straight, a chord no eye tells from the curve. */
export const LAP_POINTS = 33

const rounded = (value: number) => Math.round(value * 100) / 100

/**
 * One lap from the wire's source pin to its target pin: a transform for each point, and the share of the lap at which
 * the dot reaches it. The shares follow the wire's length, so the dot keeps one speed, as `animateMotion` does.
 */
export function pulseLap(pointAt: (t: number) => Point, points = LAP_POINTS): { transforms: string[]; times: number[] } {
  const along = Array.from({ length: points }, (_, index) => pointAt(index / (points - 1)))
  const lengths = [0]
  for (let index = 1; index < along.length; index++) {
    const [from, to] = [along[index - 1]!, along[index]!]
    lengths.push(lengths[index - 1]! + Math.hypot(to.x - from.x, to.y - from.y))
  }
  const total = lengths.at(-1)!
  return {
    transforms: along.map(({ x, y }) => `translate(${rounded(x)}px, ${rounded(y)}px)`),
    times: lengths.map((length, index) => (total > 0 ? length / total : index / (points - 1))),
  }
}
