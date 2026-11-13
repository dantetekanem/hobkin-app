/**
 * The setup's world as numbers: the outline of each ridge and of the hill, where each sits in the window, and the way
 * the character comes from behind a far ridge to the middle of the screen. Pure, so a test can hold the drawing and the
 * numbers to each other. See _specs/025-onboarding.
 */
import { FACE, footBelow, type Seat, type Viewport } from './face-size.ts'

/** A ridge, far (0) to near (3), or the hill in front of them all. */
export type Shape = 0 | 1 | 2 | 3 | 'hill'

/** Far to near, the order World draws them in. */
export const SHAPES: readonly Shape[] = [0, 1, 2, 3, 'hill']

/** z-index of each ridge, far to near, of the hill, and of things in front of everything. */
export const LAYER: { ridges: readonly [number, number, number, number]; hill: number; front: number } = {
  ridges: [10, 20, 30, 40],
  hill: 50,
  front: 60,
}

/** Where a shape's box starts down the window, as a share of the height plus pixels. It runs from there to the bottom, the full width. */
export interface Box {
  share: number
  offset: number
}

type Point = readonly [x: number, y: number]

/** A run of quadratic curves in a shape's own 1000 by 1000 box. Each curve only moves rightward, so x finds one point. */
interface Outline {
  from: Point
  curves: { control: Point; to: Point }[]
}

/**
 * A ridge the way hobkin.dev draws one, in thousandths of the window: valleys, and a peak between each two. A curve
 * leaves each valley straight up and bends into the peak, the character's own hood shape. `point` is how sharp the
 * top is: 0.5 is the site's, lower is rounder, which the peaks it lands on use so its foot meets the top.
 */
interface RidgeArt {
  valleys: Point[]
  peaks: (readonly [x: number, y: number, point: number])[]
}

/** Far to near. The far ones stand tallest. The peaks at 705, 650 and 595 are where the character lands (LANDINGS). */
const RIDGE_ART: readonly [RidgeArt, RidgeArt, RidgeArt, RidgeArt] = [
  {
    valleys: [[-60, 480], [120, 455], [235, 500], [420, 470], [520, 495], [700, 450], [800, 480], [1060, 470]],
    peaks: [[30, 320, 0.5], [175, 360, 0.5], [310, 245, 0.5], [470, 380, 0.5], [630, 270, 0.5], [750, 350, 0.5], [925, 240, 0.5]],
  },
  {
    valleys: [[-40, 560], [95, 530], [290, 565], [400, 540], [560, 550], [655, 505], [790, 560], [1050, 550]],
    peaks: [[20, 440, 0.5], [200, 395, 0.5], [345, 455, 0.5], [480, 410, 0.5], [610, 450, 0.5], [705, 380, 0.3], [920, 410, 0.5]],
  },
  {
    valleys: [[-50, 620], [130, 600], [250, 625], [440, 600], [560, 595], [735, 600], [870, 615], [1070, 610]],
    peaks: [[40, 480, 0.5], [185, 505, 0.5], [350, 460, 0.5], [500, 510, 0.5], [650, 430, 0.3], [800, 495, 0.5], [960, 465, 0.5]],
  },
  {
    valleys: [[-40, 700], [160, 680], [330, 700], [500, 660], [690, 650], [800, 690], [1050, 690]],
    peaks: [[60, 575, 0.5], [250, 600, 0.5], [410, 590, 0.5], [595, 470, 0.3], [745, 560, 0.5], [920, 545, 0.5]],
  },
]

/** Where the character stands to talk, as a share of the window's height. */
const STAGE_AT = 0.44

/**
 * The hill, in its own box, which starts where the stage's foot is: so its crest, in the middle, is always under the
 * foot, whatever the window. Flat on top, it rolls off to both sides and eases out again toward the edges. Each pair
 * of curves meets on one straight line through their controls, so the slope has no kink.
 */
const HILL: Outline = {
  from: [-20, 430],
  curves: [
    { control: [120, 430], to: [250, 200] },
    { control: [363, 0], to: [500, 0] },
    { control: [630, 0], to: [760, 190] },
    { control: [860, 336.15], to: [1020, 400] },
  ],
}

/** Two decimals, so the path World draws and the numbers here are the same numbers. */
const round = (value: number) => Math.round(value * 100) / 100

/** A ridge's outline in its box, which starts at its highest peak: rising from below the window, it travels its own height. */
function ridgeShape({ valleys, peaks }: RidgeArt): { box: Box; outline: Outline } {
  const top = Math.min(...peaks.map(([, y]) => y))
  const inBox = ([x, y]: Point): Point => [round(x), round(((y - top) / (1000 - top)) * 1000)]
  const curves = peaks.flatMap(([x, y, point], index) => {
    const [startX, startY] = valleys[index]!
    const [endX, endY] = valleys[index + 1]!
    return [
      { control: inBox([startX, y + point * (startY - y)]), to: inBox([x, y]) },
      { control: inBox([endX, y + point * (endY - y)]), to: inBox([endX, endY]) },
    ]
  })
  return { box: { share: top / 1000, offset: 0 }, outline: { from: inBox(valleys[0]!), curves } }
}

const DRAWN: Record<Shape, { box: Box; outline: Outline }> = {
  0: ridgeShape(RIDGE_ART[0]),
  1: ridgeShape(RIDGE_ART[1]),
  2: ridgeShape(RIDGE_ART[2]),
  3: ridgeShape(RIDGE_ART[3]),
  hill: { box: { share: STAGE_AT, offset: footBelow(1) }, outline: HILL },
}

/** Stars, as left and top percents of the window, then a radius in pixels. Out of order across the sky, so they do not come out in a line. */
export const STARS: readonly (readonly [left: number, top: number, radius: number])[] = [
  [33, 20, 2.4],
  [70, 5, 2.2],
  [14, 30, 1.6],
  [50, 16, 2],
  [92, 9, 1.8],
  [6, 12, 2.2],
  [58, 9, 1.7],
  [23, 8, 1.8],
  [96, 26, 1.5],
  [42, 6, 1.6],
]

/** Seconds. World moves by these, and WORLD_TIMES adds them up for the caller. */
export const PACE = {
  /** The sun or the moon rising along its arc. */
  arc: 1.5,
  /** The first star comes out this far into the sky, each next one this long after, and each takes `starFade`. */
  starFirst: 0.35,
  starStep: 0.11,
  starFade: 0.45,
  /** Each ridge rises on a spring this long, the next nearer one this long after. */
  rise: 1.4,
  riseStep: 0.15,
} as const

const seconds = (value: number) => Math.round(value * 100) / 100

/** Seconds from a phase arriving until it has finished: the last star is out, the last ridge (the hill) has settled. */
export const WORLD_TIMES: { sky: number; land: number } = {
  sky: seconds(Math.max(PACE.arc, PACE.starFirst + PACE.starStep * (STARS.length - 1) + PACE.starFade)),
  land: seconds(PACE.riseStep * (SHAPES.length - 1) + PACE.rise),
}

/** The fill runs on this far below the box, so a ridge that overshoots as it rises shows no gap under it. */
const BELOW = 1400

/** Where a shape's box starts: World places it there, down to the bottom of the window, the full width. */
export function boxOf(shape: Shape): Box {
  return DRAWN[shape].box
}

/** The SVG path of a shape, for a 1000 by 1000 viewBox stretched over its box. */
export function pathOf(shape: Shape): string {
  const { from, curves } = DRAWN[shape].outline
  const line = curves.map(({ control, to }) => `Q${control[0]} ${control[1]} ${to[0]} ${to[1]}`).join(' ')
  return `M${from[0]} ${from[1]} ${line} V${BELOW} H${from[0]} Z`
}

/** The top edge of a ridge (0 to 3) or of the hill ('hill') at a window x, once it has settled. */
export function crestY(ridge: Shape, x: number, viewport: Viewport): number {
  const { box, outline } = DRAWN[ridge]
  const top = box.share * viewport.height + box.offset
  return top + (heightAt(outline, (x / viewport.width) * 1000) / 1000) * (viewport.height - top)
}

function heightAt({ from, curves }: Outline, x: number): number {
  let start = from
  for (const { control, to } of curves) {
    if (x <= to[0]) return along(start, control, to, x)
    start = to
  }
  return start[1]
}

/** The y of a quadratic curve where it passes x: solve its x for t, then read its y there. */
function along(from: Point, control: Point, to: Point, x: number): number {
  const a = from[0] - 2 * control[0] + to[0]
  const b = 2 * (control[0] - from[0])
  const c = from[0] - x
  const isStraight = Math.abs(a) < 1e-9
  const root = isStraight ? -c / b : rootWithin(a, b, c)
  const t = Math.min(1, Math.max(0, root))
  return (1 - t) ** 2 * from[1] + 2 * (1 - t) * t * control[1] + t ** 2 * to[1]
}

/** The root of a t² + b t + c that falls on the curve, between 0 and 1. */
function rootWithin(a: number, b: number, c: number): number {
  const spread = Math.sqrt(Math.max(0, b * b - 4 * a * c))
  const first = (-b + spread) / (2 * a)
  return first >= -1e-9 && first <= 1 + 1e-9 ? first : (-b - spread) / (2 * a)
}

/** Where the character stands to talk: the middle of the window, on the crest of the hill, at scale 1. */
export function stageFor(viewport: Viewport): Seat {
  return { x: viewport.width / 2, y: viewport.height * STAGE_AT, scale: 1 }
}

export interface Hop {
  to: Seat
  /** How high the hop rises above the higher of its two ends, in pixels. Its top is halfway along. */
  lift: number
  /** Seconds in the air. */
  time: number
  /** The z-index the character takes once it is past the top of the hop. */
  layer: number
}

export interface Arrival {
  /** Where it waits before it shows: wholly below the crest of the ridge it hides behind. */
  hidden: Seat
  /** The z-index while it hides and peeks: behind that ridge, in front of the ones farther away. */
  hiddenLayer: number
  /** Raised until its eyes are over the crest, and no more. */
  peek: Seat
  /** Four or five hops from the peek to the stage. */
  hops: Hop[]
  stage: Seat
}

/** The character's art as shares of its square, from its middle (avatar/moods.tsx: the hood spans 22 to 188 and 40 to 160 of -28 to 228; the eyes sit at 138, radius 8). */
const ART = { tip: 0.305, eyes: 0.148, eyeRadius: 8 / 256, hoodHalf: 60 / 256 }

/** It hides behind ridge 1 at 72% across, as on hobkin.dev, just right of the summit it climbs first. */
const HIDE = { ridge: 1, x: 0.72, scale: 0.35 } as const
/** Pixels: hidden this far under the crest, and peeking with its eyes this far over it. */
const HIDDEN_BY = 4
const PEEK_BY = 2
/** Pixels at scale 1: the foot settles a little into the top it lands on, so it reads as standing. */
const SINK = 3

/** Where it lands on the way in, far to near, growing as it nears. The hill comes only in wide windows, which have room for five hops. */
const LANDINGS: readonly { shape: Shape; x: number; scale: number }[] = [
  { shape: 1, x: 0.705, scale: 0.42 },
  { shape: 2, x: 0.65, scale: 0.55 },
  { shape: 3, x: 0.595, scale: 0.7 },
  { shape: 'hill', x: 0.548, scale: 0.85 },
]
const WIDE = 1100

/** In front of the shape it stands on and behind the next nearer one. On the hill, in front of everything. */
function layerOn(shape: Shape): number {
  if (shape === 'hill') return LAYER.front
  return (LAYER.ridges[shape] + (shape === 3 ? LAYER.hill : LAYER.ridges[shape + 1]!)) / 2
}

/** A bigger character, nearer, hops higher and stays up longer, the way a thing falls: time grows with the root of the height. */
const liftFor = (scale: number) => 8 + 0.2 * FACE * scale
const timeFor = (scale: number) => Math.max(0.4, 0.63 * Math.sqrt(scale))

/** The way the character comes in: hidden behind a far ridge, a peek over it, then hop by hop down to the stage. */
export function arrivalFor(viewport: Viewport): Arrival {
  const { scale } = HIDE
  const size = FACE * scale
  const x = viewport.width * HIDE.x
  const crest = crestY(HIDE.ridge, x, viewport)
  // The crest falls away to one side here, so the hood hides under the lowest point of the crest across its width.
  const half = size * ART.hoodHalf
  const crestsAcross = [-1, -0.5, 0, 0.5, 1].map((share) => crestY(HIDE.ridge, x + share * half, viewport))
  const lowest = Math.max(...crestsAcross)

  const stage = stageFor(viewport)
  const landingsHere = LANDINGS.filter(({ shape }) => shape !== 'hill' || viewport.width >= WIDE)
  const landings = landingsHere.map(({ shape, x: share, scale: landed }) => {
    const at = viewport.width * share
    const foot = crestY(shape, at, viewport) + SINK * landed
    return { to: { x: at, y: foot - footBelow(landed), scale: landed }, layer: layerOn(shape) }
  })
  const steps = [...landings, { to: stage, layer: LAYER.front }]
  const hops = steps.map(({ to, layer }) => ({
    to,
    lift: liftFor(to.scale),
    time: timeFor(to.scale),
    layer,
  }))

  return {
    hidden: { x, y: lowest + HIDDEN_BY + size * ART.tip, scale },
    hiddenLayer: (LAYER.ridges[0] + LAYER.ridges[1]) / 2,
    peek: { x, y: crest - PEEK_BY - size * (ART.eyes + ART.eyeRadius), scale },
    hops,
    stage,
  }
}
