/**
 * The two choice bubbles balance against each other: the one the pointer nears grows a little, and the other gives
 * up the same amount. Pure rules only. See _specs/025-onboarding.
 */

/** The most a bubble grows, and the other shrinks, as a share of its size. Slight on purpose. */
export const GROW = 0.07

/** The most a bubble lightens, and the other darkens, as a share of its own light. */
export const GLOW = 0.22

/** How near the pointer has to be, in pixels, before a bubble feels it at all. */
export const REACH = 360

export interface Point {
  x: number
  y: number
}

/** How strongly the pointer leans to the left bubble (1), to the right one (-1), or to neither (0). */
export function lean(pointer: Point, left: Point, right: Point, reach: number = REACH): number {
  const closeness = (to: Point) => Math.max(0, 1 - Math.hypot(pointer.x - to.x, pointer.y - to.y) / reach)
  return closeness(left) - closeness(right)
}

/** The two sizes for a lean: what one gains the other gives, so together they always weigh the same. */
export function sizesFor(pull: number): [left: number, right: number] {
  return [1 + GROW * pull, 1 - GROW * pull]
}

/** How light each bubble is for a lean: the one leaned to gets lighter, and the other darker by the same. */
export function shadesFor(pull: number): [left: number, right: number] {
  return [1 + GLOW * pull, 1 - GLOW * pull]
}

/** The size of each bubble for where the pointer is, given the middle of each. */
export function balance(pointer: Point, left: Point, right: Point, reach: number = REACH): [left: number, right: number] {
  return sizesFor(lean(pointer, left, right, reach))
}
