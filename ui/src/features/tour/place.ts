/**
 * Where the tour's card and hole go. Pure geometry: boxes and sizes in, boxes out, all in window pixels.
 */

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export interface Spot {
  left: number
  top: number
}

export interface Hole extends Box {
  radius: number
}

/** The room the card keeps from the window's edge, and from the hole. */
const MARGIN = 16
const GAP = 14
/** How far the hole grows past its target, and how round it is. */
const GROW = 6
const ROUND = 14

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high))

/** The target's box grown a little, with rounded corners, kept inside the window. */
export function holeOf(target: Box | null, win: Size): Hole | null {
  if (!target) return null
  const left = Math.max(0, target.left - GROW)
  const top = Math.max(0, target.top - GROW)
  const right = Math.min(win.width, target.left + target.width + GROW)
  const bottom = Math.min(win.height, target.top + target.height + GROW)
  const width = right - left
  const height = bottom - top
  return { left, top, width, height, radius: Math.min(ROUND, width / 2, height / 2) }
}

const overlaps = (a: Box, b: Box) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height

type Side = 'below' | 'above' | 'right' | 'left'

/** Which side a target likes: below the menu at the top, right of a tall one at the left, above one near the bottom. */
function preferredSides(target: Box, win: Size): Side[] {
  const middleX = target.left + target.width / 2
  const middleY = target.top + target.height / 2
  const tall = target.height > win.height * 0.6
  let first: Side
  if (tall) {
    first = middleX < win.width / 2 ? 'right' : 'left'
  } else if (middleY < win.height / 3) {
    first = 'below'
  } else if (middleY > (win.height * 2) / 3) {
    first = 'above'
  } else {
    first = 'right'
  }
  const rest: Side[] = ['below', 'above', 'right', 'left']
  return [first, ...rest.filter((side) => side !== first)]
}

/**
 * Where the card's top left goes: beside the target on its preferred side, wholly inside the window with a margin,
 * and clear of the hole. With no target it is in the middle. When no side has room it falls back to the middle.
 */
export function placeCard(target: Box | null, card: Size, win: Size): Spot {
  const middle: Spot = { left: (win.width - card.width) / 2, top: (win.height - card.height) / 2 }
  const hole = holeOf(target, win)
  if (!target || !hole) return middle

  const centeredX = target.left + target.width / 2 - card.width / 2
  const centeredY = target.top + target.height / 2 - card.height / 2
  const at = (side: Side): Spot => {
    switch (side) {
      case 'below':
        return { left: centeredX, top: hole.top + hole.height + GAP }
      case 'above':
        return { left: centeredX, top: hole.top - GAP - card.height }
      case 'right':
        return { left: hole.left + hole.width + GAP, top: centeredY }
      case 'left':
        return { left: hole.left - GAP - card.width, top: centeredY }
    }
  }

  for (const side of preferredSides(target, win)) {
    const wanted = at(side)
    const spot = {
      left: clamp(wanted.left, MARGIN, win.width - MARGIN - card.width),
      top: clamp(wanted.top, MARGIN, win.height - MARGIN - card.height),
    }
    const fits =
      spot.left >= MARGIN &&
      spot.top >= MARGIN &&
      spot.left + card.width <= win.width - MARGIN &&
      spot.top + card.height <= win.height - MARGIN
    if (fits && !overlaps({ ...spot, ...card }, hole)) return spot
  }
  return middle
}

/** Points along each rounded corner. The same count for every hole, so one polygon can glide into another. */
const ARC = 6

/**
 * The dim layer's clip: the whole window with the hole cut out of it, as one even-odd polygon. A polygon of the same
 * points always interpolates, and clip-path is not layout, so the hole glides on the compositor-friendly path
 * without animating width or height. With no hole the ring collapses to a point in the middle, so it still glides.
 */
export function holePolygon(hole: Hole | null, win: Size): string {
  const box = hole ?? { left: win.width / 2, top: win.height / 2, width: 0, height: 0, radius: 0 }
  const { left, top, width, height, radius } = box
  const corners = [
    { x: left + width - radius, y: top + radius, from: -90 },
    { x: left + width - radius, y: top + height - radius, from: 0 },
    { x: left + radius, y: top + height - radius, from: 90 },
    { x: left + radius, y: top + radius, from: 180 },
  ]
  const ring: string[] = []
  for (const corner of corners) {
    for (let step = 0; step < ARC; step++) {
      const angle = ((corner.from + (90 * step) / (ARC - 1)) * Math.PI) / 180
      ring.push(point(corner.x + radius * Math.cos(angle), corner.y + radius * Math.sin(angle)))
    }
  }
  const outer = [point(0, 0), point(win.width, 0), point(win.width, win.height), point(0, win.height), point(0, 0)]
  // The ring starts and ends on the same point, so the join to the outer square has no area.
  return `polygon(evenodd, ${[...outer, ...ring, ring[0]!].join(', ')})`
}

const point = (x: number, y: number) => `${Math.round(x * 10) / 10}px ${Math.round(y * 10) / 10}px`
