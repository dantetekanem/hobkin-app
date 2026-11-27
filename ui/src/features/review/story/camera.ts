/**
 * Where the camera looks. Pure framing math: given what to show and the part of the canvas that is not covered, it
 * answers with a camera and with a place for the step's card: beside its node when the step has a focus, and beside
 * the whole graph for the opening and the closing. And when the camera moves at all: only for a step.
 */
import { boundsOf, ZONE_FRAME, type Point, type Rect } from '#shared/review/layout.ts'

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
  /** The proof beside the review, at the right (spec 053). */
  right?: number
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
  return {
    x: left,
    y: cover.top,
    width: Math.max(MIN_AREA, canvas.width - left - (cover.right ?? 0)),
    height: Math.max(MIN_AREA, canvas.height - cover.top - cover.bottom),
  }
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
/** How much of the two rectangles lies in both. */
function overlapArea(a: Rect, b: Rect): number {
  const sharedWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const sharedHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return Math.max(0, sharedWidth) * Math.max(0, sharedHeight)
}
/** The margin kept at the edges of the uncovered area, less in a small one. */
const marginOf = (area: Rect) => clamp(Math.min(area.width, area.height) * 0.08, 4, FRAME.margin)

// ───────────────────────────── When the camera moves ─────────────────────────────

/** How the camera answers a move: it frames the step, frames the whole graph, or shows a node only if it is out of view. */
export type Framing = 'step' | 'whole' | 'reveal'

/**
 * How a move is framed (the user, 2026-11-12: calm navigation). Going to a step, a jump, hobkin's cursor, G and the first
 * look all frame what is in focus, or the whole graph with nothing in focus. A single node the reviewer went to is told
 * where it is: the camera moves only if it is out of view. Anything that is not a move frames nothing.
 */
export function framingOf({ first, kind, focus }: { first: boolean; kind: 'open' | 'step' | 'jump' | 'detour' | 'whole'; focus: number }): Framing {
  if (focus === 0) return 'whole'
  return kind === 'detour' && focus === 1 && !first ? 'reveal' : 'step'
}

// ───────────────────────────── The card beside its node ─────────────────────────────

/**
 * A card beside a node, in canvas pixels: on which side, and how far along that side from the node's own edge where
 * it starts (its top on the right and the left, its left edge under and over it), and its box.
 */
export interface Beside extends Rect {
  side: CardSide
  offset: number
}

/** Room between a node and the card beside it, in canvas pixels. A short leader crosses it. */
export const BESIDE_GAP = 22
/** Room a card keeps from a node it slides clear of, and how much of its node's side it keeps beside it, for the leader. */
const CLEAR = 10
const MEETS = 40

/** The sides a card tries, in the order the user asked for (2026-11-12): right of the node, else left, else under or over. */
const SIDES: readonly CardSide[] = ['right', 'left', 'below', 'above']

/** A card of this size on one side of a node on screen, `offset` along that side from the node's edge. */
export function besideAt(node: Rect, card: Size, side: CardSide, offset = 0, gap = BESIDE_GAP): Beside {
  if (side === 'right') return { side, offset, x: node.x + node.width + gap, y: node.y + offset, ...card }
  if (side === 'left') return { side, offset, x: node.x - gap - card.width, y: node.y + offset, ...card }
  if (side === 'below') return { side, offset, x: node.x + offset, y: node.y + node.height + gap, ...card }
  return { side, offset, x: node.x + offset, y: node.y - gap - card.height, ...card }
}

/**
 * Every place a card tries beside its node, with how it ranks among them: each side, lined up with the node's start, its
 * middle and its end, then slid along the side just clear of each node near it, while it still keeps beside its node.
 */
function placesFor(node: Rect, card: Size, near: readonly Rect[]): { placed: Beside; rank: number }[] {
  const places: { placed: Beside; rank: number }[] = []
  SIDES.forEach((side, sideRank) => {
    const across = side === 'right' || side === 'left'
    const [length, size] = across ? [node.height, card.height] : [node.width, card.width]
    const offsets = [0, (length - size) / 2, length - size]
    const band = besideAt(node, card, side)
    for (const other of near) {
      // Only what lies across the card's way on this side.
      const inWay = across ? other.x < band.x + band.width && band.x < other.x + other.width : other.y < band.y + band.height && band.y < other.y + other.height
      if (!inWay) continue
      const [start, span] = across ? [other.y - node.y, other.height] : [other.x - node.x, other.width]
      offsets.push(start + span + CLEAR, start - CLEAR - size)
    }
    const meets = Math.min(length, MEETS)
    offsets.forEach((offset, index) => {
      if (Math.min(offset + size, length) - Math.max(offset, 0) < meets - 0.5) return
      places.push({ placed: besideAt(node, card, side, offset), rank: sideRank * 100 + Math.min(index, 3) })
    })
  })
  return places
}

/**
 * The heading of each zone's region (spec 055): the room it keeps over its nodes. A step's card keeps off it as it keeps
 * off a node (the user, 2026-11-26: the card "in a better position").
 */
export const headingsOf = (regions: readonly Rect[]): Rect[] => regions.map(({ x, y, width }) => ({ x, y, width, height: ZONE_FRAME.head }))

const inset = (rect: Rect, by: number): Rect => ({ x: rect.x + by, y: rect.y + by, width: Math.max(0, rect.width - by * 2), height: Math.max(0, rect.height - by * 2) })
/** How much of a card the others cover, as a share of the card, in steps of 2%: a sliver counts, a hair does not. */
const coverage = (card: Rect, others: readonly Rect[]) => Math.round((others.reduce((sum, other) => sum + overlapArea(card, other), 0) / Math.max(1, card.width * card.height)) * 50)
/** How much of what a card must leave in view it covers: any of it at all counts. */
const covering = (card: Rect, kept: readonly Rect[]) => Math.ceil(kept.reduce((sum, other) => sum + overlapArea(card, other), 0) / 100)
/** Costs compared in order: the first that differs decides. */
const cheaper = (a: readonly number[], b: readonly number[]) => {
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index]! < b[index]!
  return false
}

export interface PlaceInput {
  /** The node the card is beside, on screen. */
  node: Rect
  card: Size
  /** What the card must leave in view, on screen: the rest of the focus, another card. */
  keep?: readonly Rect[]
  /** Every other node on screen: the card covers as little of them as it can. */
  others?: readonly Rect[]
  /** Where the card must stay: the uncovered part of the canvas. Null places it anywhere around the node. */
  area?: Rect | null
}

/**
 * Where a card goes beside its node: inside the uncovered area, over nothing it must leave in view, over as little of the
 * other nodes as it can, and on the right of the node before the left, under and over (the user, 2026-11-12: "on the
 * right side, or left if no space"). "No room" means no room inside the uncovered area, or none clear of other cards.
 */
export function placeCard({ node, card, keep = [], others = [], area = null }: PlaceInput): Beside {
  const inside = area ? inset(area, marginOf(area)) : null
  let best: { placed: Beside; cost: number[] } | null = null
  for (const { placed, rank } of placesFor(node, card, [...keep, ...others])) {
    const outside = inside ? Math.round(((card.width * card.height - overlapArea(placed, inside)) / Math.max(1, card.width * card.height)) * 50) : 0
    const cost = [outside, covering(placed, keep), coverage(placed, others), rank]
    if (!best || cheaper(cost, best.cost)) best = { placed, cost }
  }
  return best!.placed
}

export interface StepFrameInput {
  /** The focus nodes, in graph coordinates, in the step's order. */
  focus: readonly Rect[]
  /** Every other node, in graph coordinates: the card covers as little of them as it can. */
  others?: readonly Rect[]
  /**
   * What the frame also takes in, first first, each only while all of it fits at a reading size with the card covering
   * none of it: the focus's caller and its card of tests (spec 055). In graph coordinates.
   */
  along?: readonly Rect[]
  /** The uncovered part of the canvas, in canvas pixels: the menus at the top, the pager and the code panel at the bottom, the steps panel on the left. */
  area: Rect
  /** The card's width and the height it wants, in canvas pixels. Null frames the focus alone. */
  card?: Size | null
  maxZoom?: number
  reading?: number
}

export interface StepFrame {
  camera: Camera
  /** The card beside its node, in canvas pixels under that camera, with the focus node it is beside. Null without a card. */
  card: (Beside & { anchor: number }) | null
  /** Every focus node is in the frame. Not so for a focus spread too far to read: then the card's node is, with the nearest of the rest that fit. */
  whole: boolean
}

/** The zooms a step is framed at, closest first, from the most down to the least it reads at. */
function readingZooms(most: number, least: number): number[] {
  const zooms: number[] = []
  for (let zoom = most; zoom > least + 1e-9; zoom = Math.round((zoom - 0.05) * 100) / 100) zooms.push(zoom)
  return [...zooms, least]
}

/**
 * Frames a step (the user, 2026-11-12): its focus at a size its cards read at, from 0.9 to 1.2, and its card beside
 * the node it tells, in the uncovered area. The card takes the place that covers the least of the other nodes, on the
 * right first. The camera pulls back for what the focus is wired to only to take in its caller and its tests, and only
 * as far as they read (`along`). A focus spread too wide to read keeps the card's node in the frame with the nearest of
 * the rest. A card taller than the room scrolls.
 */
export function frameStep({ focus, others = [], along = [], area, card = null, maxZoom = FRAME.maxZoom, reading = FRAME.reading }: StepFrameInput): StepFrame {
  const margin = marginOf(area)
  const room = { width: area.width - margin * 2, height: area.height - margin * 2 }
  const full = card ? { width: Math.min(card.width, room.width), height: Math.min(card.height, room.height) } : null
  const scaled = (rect: Rect, zoom: number): Rect => ({ x: rect.x * zoom, y: rect.y * zoom, width: rect.width * zoom, height: rect.height * zoom })

  type Option = { zoom: number; anchor: number; kept: number[]; placed: Beside | null; box: Rect; fits: boolean; cost: number[] }
  /** The best way to show these focus nodes, and what comes along with them, at this zoom, with the card beside one of them. */
  const optionAt = (zoom: number, kept: readonly number[], size = full, besides: readonly Rect[] = []): Option => {
    const rects = focus.map((rect) => scaled(rect, zoom))
    const alongside = besides.map((rect) => scaled(rect, zoom))
    const shown = [...kept.map((index) => rects[index]!), ...alongside]
    const rest = others.map((rect) => scaled(rect, zoom))
    let best: Option | null = null
    for (const anchor of kept) {
      const focusAround = [...rects.filter((_, index) => index !== anchor), ...alongside]
      const places = size ? placesFor(rects[anchor]!, size, [...focusAround, ...rest]) : [{ placed: null, rank: 0 }]
      for (const { placed, rank } of places) {
        const box = boundsOf([...shown, ...(placed ? [placed] : [])])
        const fits = box.width <= room.width + 0.5 && box.height <= room.height + 0.5
        // Covering the focus is worst: the card would hide what it tells. Then not fitting, then covering the rest.
        const cost = [placed ? covering(placed, focusAround) : 0, fits ? 0 : 1, placed ? coverage(placed, rest) : 0, -zoom, rank, anchor]
        if (!best || cheaper(cost, best.cost)) best = { zoom, anchor, kept: [...kept], placed, box, fits, cost }
      }
    }
    return best!
  }

  const all = focus.map((_, index) => index)
  const zooms = readingZooms(Math.max(reading, maxZoom), reading)
  // The closest zoom where the whole focus and its card fit and the card covers least; nearer zooms win a tie.
  let chosen = zooms.map((zoom) => optionAt(zoom, all)).reduce((best, option) => (cheaper(option.cost, best.cost) ? option : best))
  let whole = true
  if (!chosen.fits && focus.length > 1) {
    // Too spread to read: the card's node stays with its card, and the rest come along, nearest first, while they fit.
    const told = chosen.anchor
    const middle = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
    const apartFrom = (index: number) => Math.hypot(middle(focus[index]!).x - middle(focus[told]!).x, middle(focus[index]!).y - middle(focus[told]!).y)
    let kept = [told]
    chosen = optionAt(reading, kept)
    for (const index of all.filter((entry) => entry !== told).sort((a, b) => apartFrom(a) - apartFrom(b))) {
      const trial = optionAt(reading, [...kept, index])
      if (!trial.fits || trial.cost[0]! > 0) continue
      kept = trial.kept
      chosen = trial
    }
    whole = kept.length === focus.length
  }
  // A narrow room that holds no card beside the step at a reading size: a little smaller, down to 0.6, rather than a
  // card over another card. The closest zoom where the card covers none wins, else the closest where it fits.
  const narrow = full != null && room.width < Math.max(...focus.map((rect) => rect.width)) * reading + BESIDE_GAP + full.width
  if (full && (!chosen.fits || (narrow && chosen.cost[2]! > 0))) {
    const nearer = readingZooms(reading - 0.05, 0.6).map((zoom) => optionAt(zoom, chosen.kept))
    const fitting = nearer.filter((option) => option.fits && option.cost[0] === 0)
    const clear = fitting.find((option) => option.cost[2] === 0) ?? fitting[0]
    if (clear) {
      chosen = clear
      whole = clear.kept.length === focus.length
    }
  }
  // A short room: the card gives up height, down to the least worth showing, and scrolls, so it fits under or over its
  // node. Then the card's node alone, with its card. Then, as under a tall code panel, smaller than reads until it fits.
  const least = full ? Math.min(FRAME.minCardHeight, full.height) : 0
  const shortened = (kept: readonly number[], zoom: number) => {
    const tallest = Math.max(...kept.map((index) => focus[index]!.height)) * zoom
    return full ? { ...full, height: Math.min(full.height, Math.max(least, room.height - tallest - BESIDE_GAP)) } : null
  }
  const tries: [readonly number[], number][] = [[chosen.kept, reading], [[chosen.anchor], reading]]
  for (let zoom = reading * 0.9; zoom > 0.02; zoom *= 0.9) tries.push([[chosen.anchor], zoom])
  for (const [kept, zoom] of tries) {
    if (chosen.fits) break
    const trial = optionAt(zoom, kept, shortened(kept, zoom))
    if (trial.fits && trial.cost[0]! <= chosen.cost[0]!) {
      chosen = trial
      whole = kept.length === focus.length
    }
  }

  // The focus framed whole at a reading size takes in its caller and its tests, each while all of it still reads, the
  // card covers none of it and covers no more of the rest than before.
  if (chosen.fits && whole && chosen.zoom >= reading - 1e-9) {
    let taken: Rect[] = []
    for (const rect of along) {
      const wanted = [...taken, rect]
      const trial = zooms.map((zoom) => optionAt(zoom, chosen.kept, full, wanted)).reduce((best, option) => (cheaper(option.cost, best.cost) ? option : best))
      const coversNone = trial.cost[0] === 0
      const coversNoMore = trial.cost[2]! <= chosen.cost[2]!
      if (!trial.fits || !coversNone || !coversNoMore) continue

      taken = wanted
      chosen = trial
    }
  }

  // The camera puts the middle of what it frames at the middle of the uncovered area.
  const { zoom, box, placed, anchor } = chosen
  const camera = { x: (box.x + box.width / 2) / zoom, y: (box.y + box.height / 2) / zoom, zoom }
  if (!placed) return { camera, card: null, whole }
  const shift = { x: area.x + area.width / 2 - (box.x + box.width / 2), y: area.y + area.height / 2 - (box.y + box.height / 2) }
  return { camera, card: { ...placed, x: placed.x + shift.x, y: placed.y + shift.y, anchor }, whole }
}

export interface RevealInput {
  /** The node to show, in graph coordinates. */
  node: Rect
  /** Where the camera is now. */
  camera: Camera
  area: Rect
  /** The size of the card that comes beside it, in canvas pixels. */
  card?: Size | null
  others?: readonly Rect[]
  maxZoom?: number
  reading?: number
}

/**
 * The camera that shows a node the reviewer went to off the story's path, as calmly as it can: none at all when the
 * node and its card are in view already, as a node just clicked is, so looking never moves the graph. Otherwise the
 * least pan that brings them in, at the zoom the reviewer has, unless that is too far to read or closer than reads.
 */
export function revealNode({ node, camera, area, card = null, others = [], maxZoom = FRAME.maxZoom, reading = FRAME.reading }: RevealInput): Camera | null {
  const room = inset(area, marginOf(area))
  const zoom = Math.min(maxZoom, Math.max(reading, camera.zoom))
  const at = zoom === camera.zoom ? camera : { ...camera, x: node.x + node.width / 2, y: node.y + node.height / 2, zoom }
  const viewport = viewportFor(at, area)
  const onScreen = (rect: Rect) => ({ x: rect.x * zoom + viewport.x, y: rect.y * zoom + viewport.y, width: rect.width * zoom, height: rect.height * zoom })
  const shown = onScreen(node)
  const size = card ? { width: Math.min(card.width, room.width), height: Math.min(card.height, room.height) } : null
  const placed = size ? placeCard({ node: shown, card: size, others: others.map(onScreen), area }) : null
  const box = boundsOf([shown, ...(placed ? [placed] : [])])
  const fits = (start: number, length: number, from: number, span: number) => {
    if (length > span) return from + span / 2 - (start + length / 2)
    if (start < from) return from - start
    if (start + length > from + span) return from + span - (start + length)
    return 0
  }
  const dx = fits(box.x, box.width, room.x, room.width)
  const dy = fits(box.y, box.height, room.y, room.height)
  if (at === camera && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null
  return cameraFor({ x: viewport.x + dx, y: viewport.y + dy, zoom }, area)
}

export interface OpeningShot {
  camera: Camera
  /** The card, in canvas pixels: as tall as its words while they fit, then it scrolls. */
  card: PlacedCard
}

/**
 * Frames the whole graph for the story's opening or closing (the user, 2026-11-12), with its card in the top right corner
 * of the uncovered area, under the menus, as tall as its words up to the room: never clipped. The whole graph is framed
 * in the room left of the card or under it, whichever draws it larger, so the card covers none of it (the user,
 * 2026-11-26). A room with neither gives the graph all of it, and the card stands over its corner.
 */
export function frameOpening({ graph, area, card, maxZoom = FRAME.maxZoom }: { graph: readonly Rect[]; area: Rect; card: Size; maxZoom?: number }): OpeningShot {
  const margin = marginOf(area)
  const room = { x: area.x + margin, y: area.y + margin, width: area.width - margin * 2, height: area.height - margin * 2 }
  const width = Math.min(card.width, room.width)
  const height = Math.min(card.height, room.height)
  const box = boundsOf(graph)
  const fit = (space: Rect) => Math.max(0.01, Math.min(maxZoom, space.width / Math.max(1, box.width), space.height / Math.max(1, box.height)))
  const leftOfCard = { ...room, width: room.width - width - FRAME.gap }
  const underCard = { ...room, y: room.y + height + FRAME.gap, height: room.height - height - FRAME.gap }
  // Left of the card wins a tie, as the opening always had it.
  const spaces = [leftOfCard, underCard].filter((space) => space.width > 0 && space.height > 0)
  const space = spaces.reduce<Rect>((best, each) => (fit(each) > fit(best) ? each : best), spaces[0] ?? room)
  const zoom = fit(space)
  // The graph's middle at the middle of its room.
  const viewport = { x: space.x + space.width / 2 - (box.x + box.width / 2) * zoom, y: space.y + space.height / 2 - (box.y + box.height / 2) * zoom, zoom }
  return { camera: cameraFor(viewport, area), card: { side: 'right', x: room.x + room.width - width, y: room.y, width, height } }
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
  const box = closer > 1
    ? {
        x: whole.x + (whole.width - whole.width / closer) / 2,
        y: whole.y + (whole.height - whole.height / closer) / 2,
        width: whole.width / closer,
        height: whole.height / closer,
      }
    : whole
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
