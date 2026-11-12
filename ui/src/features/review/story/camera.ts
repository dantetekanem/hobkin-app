/**
 * Where the camera looks. Pure framing math: given what to show and the part of the canvas that is not
 * covered, it answers with a camera and with a place for the step's text: hung under its node when the step
 * has a focus, and beside the whole graph for the opening and the closing.
 */
import { boundsOf, type Point, type Rect } from '#shared/review/layout.ts'

export interface Size {
  width: number
  height: number
}

/**
 * The camera, as the point of the graph that sits at the middle of the uncovered area, and the zoom.
 * Saying it this way means the same camera stays right while the code panel slides the area up and down.
 */
export interface Camera {
  x: number
  y: number
  zoom: number
}

/** React Flow's viewport: a point of the graph is drawn at `point * zoom + (x, y)`. */
export interface Viewport {
  x: number
  y: number
  zoom: number
}

/**
 * Pixels of the canvas that something lies over: the frame's menu at the top, the step pager and the code panel at
 * the bottom, and the steps panel on the left, by as much of it as is on screen.
 */
export interface Cover {
  top: number
  bottom: number
  left?: number
}

export type CardSide = 'right' | 'left' | 'below' | 'above'

export interface PlacedCard extends Rect {
  side: CardSide
}

export interface Shot {
  camera: Camera
  /** Where the step's text goes, in canvas pixels. Null when there is no room for it beside the focus. */
  card: PlacedCard | null
}

export const FRAME = {
  /** Room kept between the focus, or its text, and the edge of the uncovered area. */
  margin: 20,
  /** Room between the whole graph and the text of the opening or the closing beside it. */
  gap: 20,
  /** The focus is shown at most a little over its real size, close enough to read (the user's 1.2, 2026-11-12). */
  maxZoom: 1.2,
  /**
   * The least a focus is framed at, so its cards read: two nodes side by side fit at it with the steps panel open. A focus
   * spread wider is not pulled back for: the node its step is told on stays in the frame, with the nearest of the rest.
   */
  reading: 0.9,
  /** Room between a node and the step's text hung under it, in points of the graph. */
  hang: 14,
  /** The least of that text worth showing. A short room gives up the rest of it, and the text scrolls. */
  leastText: 110,
  /** The least of a card that is worth showing. A shorter area hides the text. */
  minCardHeight: 120,
  /**
   * How much closer than a fit the whole graph is framed when a story opens on it: its middle fills the room and its
   * edges may run under what covers the canvas. G frames all of it, and a step's focus is always shown whole.
   */
  closer: 1.2,
} as const

const MIN_AREA = 24

export function uncoveredArea(canvas: Size, cover: Cover): Rect {
  const left = cover.left ?? 0
  return { x: left, y: cover.top, width: Math.max(MIN_AREA, canvas.width - left), height: Math.max(MIN_AREA, canvas.height - cover.top - cover.bottom) }
}

export function viewportFor(camera: Camera, area: Rect): Viewport {
  return { x: area.x + area.width / 2 - camera.x * camera.zoom, y: area.y + area.height / 2 - camera.y * camera.zoom, zoom: camera.zoom }
}

export function cameraFor(viewport: Viewport, area: Rect): Camera {
  return { x: (area.x + area.width / 2 - viewport.x) / viewport.zoom, y: (area.y + area.height / 2 - viewport.y) / viewport.zoom, zoom: viewport.zoom }
}

/** A rectangle of the graph as it lands on the canvas. */
export function toScreen(rect: Rect, camera: Camera, area: Rect): Rect {
  const viewport = viewportFor(camera, area)
  return { x: rect.x * viewport.zoom + viewport.x, y: rect.y * viewport.zoom + viewport.y, width: rect.width * viewport.zoom, height: rect.height * viewport.zoom }
}

export function pointToScreen(point: Point, viewport: Viewport): Point {
  return { x: point.x * viewport.zoom + viewport.x, y: point.y * viewport.zoom + viewport.y }
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high))
const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const apart = (a: Rect, b: Rect) => Math.hypot(a.x + a.width / 2 - (b.x + b.width / 2), a.y + a.height / 2 - (b.y + b.height / 2))
/** The margin kept at the edges of the uncovered area, less in a small one. */
const marginOf = (area: Rect) => clamp(Math.min(area.width, area.height) * 0.08, 4, FRAME.margin)

/** The step's text, hung under one of the focus nodes, in points of the graph. */
export interface Hung extends Rect {
  /** The focus node it hangs from, by its place in the focus. */
  anchor: number
}

/**
 * Where the step's text hangs: right under the first focus node with nothing else of the focus under it, as wide as that
 * node, so the text reads as the node's own. The node lowest down always has that room, so the text is never on a focus node.
 */
export function hangText(focus: readonly Rect[], height: number): Hung | null {
  if (focus.length === 0 || !(height > 0)) return null
  const under = (anchor: number): Hung => {
    const node = focus[anchor]!
    return { anchor, x: node.x, y: node.y + node.height + FRAME.hang, width: node.width, height }
  }
  for (let anchor = 0; anchor < focus.length; anchor += 1) {
    const place = under(anchor)
    if (focus.every((node) => !overlaps(place, node))) return place
  }
  return under(focus.reduce((lowest, node, index) => (node.y + node.height > focus[lowest]!.y + focus[lowest]!.height ? index : lowest), 0))
}

export interface FocusShot {
  camera: Camera
  /** The step's text where it hangs, with the height it is given: less than it asked for in a short room, where it scrolls. */
  text: Hung | null
  /** Every focus node is in the frame. Not so for a focus spread too far to read: then the node the text hangs from is, with the nearest of the rest that fit. */
  whole: boolean
}

export interface FocusInput {
  /** The focus nodes, in graph coordinates, in the step's order. */
  focus: readonly Rect[]
  /** The uncovered part of the canvas, in canvas pixels. */
  area: Rect
  /** How tall the step's text is at the width of its node, in points of the graph. Null frames the focus alone. */
  text?: number | null
  maxZoom?: number
  reading?: number
}

/**
 * Frames a focus at a size its cards read at, with the step's text hung under its node. It never pulls back to take in
 * what the focus is wired to, nor for a focus spread wider than reads: then the node the text hangs from stays in the
 * frame with its text, and the rest of the focus comes along, nearest first, while it still fits. A short room shortens
 * the text, down to its least, before it shrinks the cards.
 */
export function frameFocus({ focus, area, text = null, maxZoom = FRAME.maxZoom, reading = FRAME.reading }: FocusInput): FocusShot {
  const margin = marginOf(area)
  const room = { width: area.width - margin * 2, height: area.height - margin * 2 }
  const fit = (box: Rect) => Math.max(0.01, Math.min(maxZoom, room.width / Math.max(1, box.width), room.height / Math.max(1, box.height)))
  const hung = text != null ? hangText(focus, text) : null
  const least = hung ? Math.min(hung.height, FRAME.leastText) : 0

  /** These nodes with the text, the text shortened toward its least while that keeps them at a reading size. */
  const take = (rects: readonly Rect[]) => {
    if (!hung) {
      const box = boundsOf(rects)
      return { box, zoom: fit(box), text: null }
    }
    // Every point the text gives up shortens the frame by as much, until the nodes alone set its height.
    const over = boundsOf([...rects, hung]).height - room.height / reading
    const placed = { ...hung, height: clamp(hung.height - Math.max(0, over), least, hung.height) }
    const box = boundsOf([...rects, placed])
    return { box, zoom: fit(box), text: placed }
  }

  let best = take(focus)
  let whole = true
  if (best.zoom < reading - 1e-9 && focus.length > 1) {
    const told = focus[hung?.anchor ?? 0]!
    const kept = [told]
    best = take(kept)
    for (const rect of focus.filter((rect) => rect !== told).sort((a, b) => apart(a, told) - apart(b, told))) {
      const trial = take([...kept, rect])
      if (trial.zoom < reading - 1e-9) continue
      kept.push(rect)
      best = trial
    }
    whole = kept.length === focus.length
  }
  return { camera: { x: best.box.x + best.box.width / 2, y: best.box.y + best.box.height / 2, zoom: best.zoom }, text: best.text, whole }
}

export interface ShotInput {
  /** The nodes to frame, in graph coordinates. */
  focus: readonly Rect[]
  /** The uncovered part of the canvas, in canvas pixels. */
  area: Rect
  /** The size the step's text wants. Null frames the focus alone. */
  card?: Size | null
  /** Every other node. The text goes to the side where it covers the least of them. */
  others?: readonly Rect[]
  maxZoom?: number
  /** Over 1, only the middle of the focus is fitted, so it is drawn this much bigger and its edges run past the room. */
  closer?: number
}

/**
 * Frames the focus inside the uncovered area, fully, with its text beside it.
 *
 * The text goes beside the focus when the area is wide enough to show both at a good size, and under or over
 * it otherwise. Between two sides of the same kind, it takes the one with the most room: the one where it
 * covers the least of the other nodes. It is never placed on top of a focus node.
 */
export function composeShot({ focus, area, card = null, others = [], maxZoom = FRAME.maxZoom, closer = 1 }: ShotInput): Shot {
  const whole = boundsOf(focus)
  const box = closer > 1 ? { x: whole.x + (whole.width - whole.width / closer) / 2, y: whole.y + (whole.height - whole.height / closer) / 2, width: whole.width / closer, height: whole.height / closer } : whole
  const margin = marginOf(area)
  const [roomWidth, roomHeight] = [area.width - margin * 2, area.height - margin * 2]
  const fit = (width: number, height: number) => Math.max(0.01, Math.min(maxZoom, width / Math.max(1, box.width), height / Math.max(1, box.height)))

  /** The camera that draws the focus box with its top left corner at a canvas point. */
  const cameraAt = (left: number, top: number, zoom: number): Camera =>
    cameraFor({ x: left - box.x * zoom, y: top - box.y * zoom, zoom }, area)

  const alone = (): Shot => {
    const zoom = fit(roomWidth, roomHeight)
    return { camera: cameraAt(area.x + (area.width - box.width * zoom) / 2, area.y + (area.height - box.height * zoom) / 2, zoom), card: null }
  }
  if (!card || focus.length === 0) return alone()

  const least = Math.min(card.height, FRAME.minCardHeight)
  const candidates: { shot: Shot; score: number; covered: number; order: number }[] = []
  const consider = (side: CardSide, order: number) => {
    const beside = side === 'right' || side === 'left'
    let zoom: number
    let height: number
    if (beside) {
      const width = roomWidth - FRAME.gap - card.width
      height = Math.min(card.height, roomHeight)
      if (width <= 0 || height < least) return
      zoom = fit(width, roomHeight)
    } else {
      if (card.width > roomWidth) return
      zoom = fit(roomWidth, roomHeight)
      height = Math.min(card.height, roomHeight - FRAME.gap - box.height * zoom)
      if (height < least) {
        // Not enough room under the focus at this size: show the focus smaller and keep the least of the text.
        height = least
        const left = roomHeight - FRAME.gap - least
        if (left <= 0) return
        zoom = fit(roomWidth, left)
      }
    }

    const [focusWidth, focusHeight] = [box.width * zoom, box.height * zoom]
    let focusLeft: number
    let focusTop: number
    let cardLeft: number
    let cardTop: number
    if (beside) {
      const groupLeft = area.x + (area.width - (focusWidth + FRAME.gap + card.width)) / 2
      focusLeft = side === 'right' ? groupLeft : groupLeft + card.width + FRAME.gap
      cardLeft = side === 'right' ? groupLeft + focusWidth + FRAME.gap : groupLeft
      focusTop = area.y + (area.height - focusHeight) / 2
      cardTop = clamp(focusTop + focusHeight / 2 - height / 2, area.y + margin, area.y + area.height - margin - height)
    } else {
      const groupTop = area.y + (area.height - (focusHeight + FRAME.gap + height)) / 2
      focusTop = side === 'below' ? groupTop : groupTop + height + FRAME.gap
      cardTop = side === 'below' ? groupTop + focusHeight + FRAME.gap : groupTop
      focusLeft = area.x + (area.width - focusWidth) / 2
      cardLeft = clamp(focusLeft + focusWidth / 2 - card.width / 2, area.x + margin, area.x + area.width - margin - card.width)
    }

    const camera = cameraAt(focusLeft, focusTop, zoom)
    const placed: PlacedCard = { side, x: cardLeft, y: cardTop, width: card.width, height }
    candidates.push({
      shot: { camera, card: placed },
      // How well this side shows both: the size of the focus, and how much of the text fits.
      score: (zoom / maxZoom) * (0.5 + 0.5 * (height / card.height)),
      covered: others.reduce((sum, other) => sum + overlapArea(placed, toScreen(other, camera, area)), 0),
      order,
    })
  }
  consider('right', 0)
  consider('left', 1)
  consider('below', 2)
  consider('above', 3)
  if (candidates.length === 0) return alone()

  // Beside or under is decided by what shows best. Which of the two sides is decided by room.
  const best = Math.max(...candidates.map((candidate) => candidate.score))
  const kind = (candidate: (typeof candidates)[number]) => (candidate.order < 2 ? 0 : 1)
  const winner = candidates.filter((candidate) => candidate.score >= best - 1e-6).sort((a, b) => a.order - b.order)[0]!
  return candidates.filter((candidate) => kind(candidate) === kind(winner) && candidate.score >= best - 1e-6).sort((a, b) => a.covered - b.covered || a.order - b.order)[0]!.shot
}
