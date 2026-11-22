/**
 * What the number parts share and a test can read without drawing them: the data shapes each part takes, the series
 * colors, and the scale rules. The colors are the app's chart and status tokens, checked with the dataviz validator
 * against the card surface in both themes: hobkin's yellow is a fifth darker for a mark (it is lighter than any
 * chart color can be on cream), and the green is a quarter darker, so it stays apart from red for a red-green
 * colorblind reader. Text never wears a series color.
 */

export const SERIES_COLOR = {
  /** Merged by itself: hobkin's own yellow. */
  itself: 'color-mix(in oklab, var(--chart-1) 82%, black)',
  /** Merged on the user's yes. */
  you: 'var(--chart-3)',
  /** Declined, as a line over the merges. */
  declined: 'var(--chart-5)',
  /** An AI review that said safe; a proof that holds. */
  good: 'color-mix(in oklab, var(--hb-ok) 75%, black)',
  /** An AI review that said risky. */
  risky: 'var(--hb-warn)',
  /** A proof that broke. */
  broken: 'var(--hb-bad)',
  /** What ended with no answer. */
  quiet: 'var(--hb-border-strong)',
  /** One series with nothing to tell apart: tokens, a sparkline. */
  plain: 'var(--hb-border-strong)',
  /** The newest bar of a sparkline, in hobkin's yellow as a mark takes it. */
  now: 'color-mix(in oklab, var(--chart-1) 82%, black)',
  /** A rate line. */
  line: 'var(--chart-3)',
} as const

/** A funnel's steps, light to dark in one hue, so their order shows in the color. Checked as an ordinal ramp. */
export function stepColor(index: number, count: number): string {
  const strength = count <= 1 ? 100 : Math.round(50 + (50 * index) / (count - 1))
  return `color-mix(in oklab, var(--chart-3) ${strength}%, var(--hb-surface))`
}

/** Where a chart stands. `loading` and `no-data` keep the chart's box and draw words in it instead of marks. */
export type ChartStatus = 'ready' | 'loading' | 'no-data'

/** One series of a chart by day: a value for each day, oldest first. */
export interface DaySeries {
  key: string
  label: string
  /** A CSS color, one of `SERIES_COLOR`. */
  color: string
  values: readonly number[]
}

/** One point of a rate line: a run of days, its rate, and how many it is a rate of. */
export interface RatePoint {
  from: string
  to: string
  /** Null where nothing was under it: the line has a gap there. */
  rate: number | null
  count: number
}

/** One gate of a funnel. */
export interface FunnelStep {
  key: string
  label: string
  count: number
}

/** One project in the table. */
export interface ProjectRow {
  slug: string
  name: string
  merged: number
  /** Of its merges, the share hobkin merged by itself. Null with nothing merged. */
  byItself: number | null
  /** Of its changes merged or declined, the share never sent back first. Null with nothing decided. */
  firstPass: number | null
  /** The median wait for the user's yes or no, in milliseconds. Null with nothing measured. */
  wait: number | null
  /** Its merges by day, oldest first, for the sparkline. */
  series: readonly number[]
}

const STEPS = [1, 2, 4, 6, 8, 10] as const

/** The top of a count axis: the smallest of 1, 2, 4, 6, 8 or 10 times a power of ten at or above `most`, so its half is a whole number. */
export function niceMax(most: number): number {
  if (!(most > 0)) return 1
  const power = 10 ** Math.floor(Math.log10(most))
  for (const step of STEPS) if (most <= step * power) return step * power
  return 10 * power
}

/** The ticks of a count axis: 0, half and the top; just 0 and 1 when the top is 1. */
export const ticksOf = (top: number): number[] => (top <= 1 ? [0, top] : [0, top / 2, top])

/** Which column of `count` a point at `x` of `width` falls in. */
export const columnAt = (x: number, width: number, count: number): number => (width > 0 && count > 0 ? Math.min(count - 1, Math.max(0, Math.floor((x / width) * count))) : 0)

/** The column a Left or Right key moves to, held inside the chart. Null when the key is neither. */
export function stepColumn(key: string, at: number | null, count: number): number | null {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null
  if (count === 0) return null
  if (at === null) return count - 1
  return Math.min(count - 1, Math.max(0, at + (key === 'ArrowRight' ? 1 : -1)))
}
