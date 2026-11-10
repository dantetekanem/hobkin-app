/**
 * The sky's drawing, in pixels: the hills, the path the sun and the moon travel, where each mark sits on
 * that path, and the times along the ground. `sky-math.ts` decides what is in the sky; this file decides
 * where it is drawn at a given width.
 */
import { fractionAt, sunHeight, type SkyMark, type Span } from './sky-math.ts'
import { dateText, instantOf, wallTime } from './timeline.ts'

export const SKY_HEIGHT = 208
export const HORIZON = 146
/** How far above the horizon the sun stands at noon. */
const RISE = 104
/** The moon keeps lower than the sun, so the night reads as the quieter part of the day. */
const MOON = 0.55
/** The middle of the row of times along the front hill. */
export const GROUND = SKY_HEIGHT - 13
/** Marks closer than this share a time and stack upward. */
const CROWDED = 11
/** How far a stacked mark sits above the one under it. */
const STACKED = 12
/** The clock under now takes this much room on each side, and the hour labels keep out of it. */
const NOW_CLOCK_ROOM = 36

/** Where the path of the sun, or of the moon at night, is at an instant. */
export function heightAt(span: Span, instant: number): number {
  const sun = sunHeight(span, instant)
  const above = sun >= 0 ? sun : -sun * MOON
  return HORIZON - above * RISE
}

/** Stars as shares of the sky's width and of the height above the hills, with their radius. */
export const STARS = [
  [0.04, 0.2, 1.6],
  [0.11, 0.46, 1.2],
  [0.17, 0.12, 1.9],
  [0.26, 0.34, 1.3],
  [0.33, 0.07, 1.5],
  [0.41, 0.28, 1.1],
  [0.49, 0.13, 1.8],
  [0.56, 0.4, 1.2],
  [0.63, 0.09, 1.4],
  [0.7, 0.3, 1.7],
  [0.78, 0.16, 1.2],
  [0.85, 0.38, 1.5],
  [0.92, 0.1, 1.3],
  [0.97, 0.3, 1.8],
] as const

/** The hills, back to front: the height of each ridge at nine even steps, and how far it drifts when the sky pulls back. */
export const RIDGES = [
  { fill: 'var(--hb-ridge-0)', heights: [138, 124, 133, 119, 129, 122, 135, 121, 131], drift: -8 },
  { fill: 'var(--hb-ridge-1)', heights: [157, 147, 160, 145, 154, 149, 158, 146, 154], drift: -16 },
  { fill: 'var(--hb-ridge-2)', heights: [173, 165, 176, 163, 172, 167, 174, 165, 172], drift: -26 },
  { fill: 'var(--hb-ridge-3)', heights: [186, 181, 188, 182, 187, 181, 186, 182, 186], drift: -38 },
] as const

/** A smooth ridge across a little more than the width, so it can drift without showing its ends. */
function ridgePath(heights: readonly number[], width: number): string {
  const left = -60
  const step = (width + 120) / (heights.length - 1)
  const points = heights.map((height, index) => [left + index * step, height] as const)
  const [firstX, firstY] = points[0]!
  const [lastX, lastY] = points.at(-1)!

  let d = `M${left} ${SKY_HEIGHT} L${firstX} ${firstY}`
  // Each bend curves through a point and ends halfway to the next one, so the ridge has no corners.
  for (let index = 1; index < points.length - 1; index += 1) {
    const [x, y] = points[index]!
    const [nextX, nextY] = points[index + 1]!
    d += ` Q${x.toFixed(1)} ${y} ${((x + nextX) / 2).toFixed(1)} ${(y + nextY) / 2}`
  }
  return `${d} L${lastX.toFixed(1)} ${lastY} L${lastX.toFixed(1)} ${SKY_HEIGHT} Z`
}

const instantAtX = (span: Span, width: number, x: number) => span.start + (x / width) * (span.end - span.start)

/** The path the sun and the moon travel across the span, and the parts of it that are day. */
function trackPaths(span: Span, width: number): { all: string; day: string } {
  let all = ''
  let day = ''
  let inDay = false
  for (let x = 0; x <= width; x += 4) {
    const instant = instantAtX(span, width, x)
    const y = heightAt(span, instant).toFixed(1)
    all += `${x === 0 ? 'M' : 'L'}${x} ${y}`

    const sunUp = sunHeight(span, instant) > 0.02
    if (sunUp) day += `${inDay ? 'L' : 'M'}${x} ${y}`
    inDay = sunUp
  }
  return { all, day }
}

/** A stretch of the track between two shares of the span, for a window, with how high and low it goes. */
function stretchPath(span: Span, width: number, from: number, to: number): { d: string; top: number; bottom: number } {
  const start = from * width
  const end = Math.max(start + 1, to * width)
  let d = ''
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (let x = start; ; x += 3) {
    const at = Math.min(x, end)
    const y = heightAt(span, instantAtX(span, width, at))
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
    d += `${d ? 'L' : 'M'}${at.toFixed(1)} ${y.toFixed(1)}`
    if (at >= end) break
  }
  return { d, top, bottom }
}

const two = (value: number) => String(value).padStart(2, '0')
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function weekdayOf(timezone: string, instant: number): string {
  const date = wallTime(timezone, instant)
  return WEEKDAY[new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()]!
}

export interface TimeLabel {
  key: string
  x: number
  text: string
  strong: boolean
}

/** One name a day, under the middle of the day: "Today", then "Tue 10". None under the clock at now. */
function dayLabels(span: Span, width: number, zone: string, now: number): TimeLabel[] {
  const nowX = fractionAt(span, now) * width
  const labels = span.days.slice(0, -1).map((start, index) => {
    const date = wallTime(zone, start)
    const middle = (start + span.days[index + 1]!) / 2
    return {
      key: `day:${dateText(date)}`,
      x: fractionAt(span, middle) * width,
      text: index === 0 ? 'Today' : `${weekdayOf(zone, start)} ${date.day}`,
      strong: index === 0,
    }
  })
  return labels.filter((label) => Math.abs(label.x - nowX) >= NOW_CLOCK_ROOM)
}

/** Every three hours, with the day's name at midnight. None under the clock at now, or at the very edges. */
function hourLabels(span: Span, width: number, zone: string, now: number): TimeLabel[] {
  const nowX = fractionAt(span, now) * width
  const labels: TimeLabel[] = []
  for (const midnight of span.days) {
    const date = wallTime(zone, midnight)
    for (let hour = 0; hour < 24; hour += 3) {
      const instant = instantOf(zone, date, `${two(hour)}:00`)
      if (instant === null || instant <= span.start || instant >= span.end) continue

      const x = fractionAt(span, instant) * width
      const underNow = Math.abs(x - nowX) < NOW_CLOCK_ROOM
      const atEdge = x < 16 || x > width - 16
      if (underNow || atEdge) continue

      labels.push({
        key: `hour:${dateText(date)}:${hour}`,
        x,
        text: hour === 0 ? weekdayOf(zone, midnight) : `${two(hour)}:00`,
        strong: hour === 0,
      })
    }
  }
  return labels
}

export type PointMark = Exclude<SkyMark, { kind: 'band' }>

export interface PlacedMark {
  mark: PointMark
  x: number
  y: number
}

/** Each point mark at its place on the track. Marks that would sit on top of each other stack upward. */
function placeMarks(span: Span, width: number, marks: readonly SkyMark[]): PlacedMark[] {
  const points = marks.filter((mark): mark is PointMark => mark.kind !== 'band').toSorted((first, second) => first.x - second.x)
  // The x of the last mark in each lane, lowest lane first.
  const lanes: number[] = []
  const placed: PlacedMark[] = []
  for (const mark of points) {
    const x = mark.x * width
    let lane = 0
    while (lanes[lane] !== undefined && lanes[lane]! > x - CROWDED) lane += 1
    lanes[lane] = x
    placed.push({ mark, x, y: heightAt(span, mark.at) - lane * STACKED })
  }
  return placed
}

export interface PlacedBand {
  mark: Extract<SkyMark, { kind: 'band' }>
  d: string
  top: number
  bottom: number
}

export interface Scene {
  /** The width it was drawn for, in CSS pixels. */
  width: number
  track: { all: string; day: string }
  ridges: string[]
  labels: TimeLabel[]
  /** Where each midnight inside the span is. */
  midnights: number[]
  bands: PlacedBand[]
  points: PlacedMark[]
}

export interface SceneInput {
  span: Span
  width: number
  zone: string
  labels: 'hours' | 'days'
  now: number
  marks: readonly SkyMark[]
}

/** Everything the sky draws, at a width. */
export function sceneOf({ span, width, zone, labels, now, marks }: SceneInput): Scene {
  const bands: PlacedBand[] = []
  for (const mark of marks) {
    if (mark.kind === 'band') bands.push({ mark, ...stretchPath(span, width, mark.x, mark.end) })
  }

  return {
    width,
    track: trackPaths(span, width),
    ridges: RIDGES.map((ridge) => ridgePath(ridge.heights, width)),
    labels: labels === 'days' ? dayLabels(span, width, zone, now) : hourLabels(span, width, zone, now),
    midnights: span.days.filter((midnight) => midnight > span.start && midnight < span.end).map((midnight) => fractionAt(span, midnight) * width),
    bands,
    points: placeMarks(span, width, marks),
  }
}
