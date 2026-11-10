/**
 * Where the camera looks. Pure framing math: given what to show and the part of the canvas that is not
 * covered, it answers with a camera and with a place for the step's text beside the focus.
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
 * Pixels of the canvas that something lies over: the frame's menu at the top, the rail and the code panel at
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
  /** Room between the focus and its text. */
  gap: 20,
  /** The focus is never blown up past its real size to fill the room. */
  maxZoom: 1,
  /** The least of a card that is worth showing. A shorter area hides the text. */
  minCardHeight: 120,
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
}

/**
 * Frames the focus inside the uncovered area, fully, with its text beside it.
 *
 * The text goes beside the focus when the area is wide enough to show both at a good size, and under or over
 * it otherwise. Between two sides of the same kind, it takes the one with the most room: the one where it
 * covers the least of the other nodes. It is never placed on top of a focus node.
 */
export function composeShot({ focus, area, card = null, others = [], maxZoom = FRAME.maxZoom }: ShotInput): Shot {
  const box = boundsOf(focus)
  const margin = clamp(Math.min(area.width, area.height) * 0.08, 4, FRAME.margin)
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
