import { emptyMetricsDay, ratesOf, type MetricsDay } from '#shared/protocol/metrics.ts'

/**
 * How the numbers read (_specs/053-work-control-room, "Numbers"): shares, spans, tokens and days in the app's words,
 * the folds the charts draw, and the six tiles' lines. Pure, so each rule can be tested alone.
 */

/** What a rate or a span with nothing under it says, never 0% or 100% of nothing. */
export const NO_DATA = 'no data yet'

/** A share as "82%". One that is neither none nor all never rounds to 0% or 100%. Null reads "no data yet". */
export function shareWords(share: number | null): string {
  if (share === null || !Number.isFinite(share)) return NO_DATA
  const percent = Math.round(share * 100)
  if (share > 0 && percent === 0) return '<1%'
  if (share < 1 && percent === 100) return '>99%'
  return `${percent}%`
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/** One decimal, without a trailing ".0". */
const tenths = (value: number) => String(Math.round(value * 10) / 10)

/** A span as "42 min" under an hour, "1.5 h" or "26 h" under two days, then "3 days". Null reads "no data yet". */
export function spanWords(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return NO_DATA
  if (ms < MINUTE_MS) return 'under 1 min'
  const minutes = Math.round(ms / MINUTE_MS)
  if (minutes < 60) return `${minutes} min`
  const hours = ms / HOUR_MS
  if (hours < 10) return `${tenths(hours)} h`
  if (hours < 48) return `${Math.round(hours)} h`
  const days = Math.round(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

const UNITS = [
  [1e3, 'K'],
  [1e6, 'M'],
  [1e9, 'B'],
] as const

/** A large amount short: "950K", "1.2M", "38M", "1.1B". Under ten of a unit it keeps one decimal. */
function compact(amount: number): string {
  if (amount < 999.5) return String(Math.round(amount))
  for (const [size, unit] of UNITS) {
    const value = amount / size
    const shown = value < 10 ? Math.round(value * 10) / 10 : Math.round(value)
    if (shown < 1000 || unit === 'B') return `${shown}${unit}`
  }
  return String(amount)
}

/** Tokens as the tiles say them: "38M". */
export const tokenWords = (tokens: number): string => compact(Math.max(0, tokens))

/** A count in full under ten thousand ("1,284"), short above it ("12.9K"). */
export const countWords = (count: number): string => (count < 10_000 ? count.toLocaleString('en') : compact(count))

/** A local day as `YYYY-MM-DD`, the shape `MetricsDay.day` has. */
export function localDay(at: Date | number): string {
  const date = new Date(at)
  const two = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

/** The local date a `YYYY-MM-DD` names, at midnight. */
export function dateOf(day: string): Date {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  return new Date(year, month - 1, date)
}

const SHORT = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
const LONG = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' })

/** A day under an axis: "Nov 14". */
export const shortDay = (day: string): string => SHORT.format(dateOf(day))

/** A day in a readout: "Today", "Yesterday", or "Sat, Nov 14". `today` is the newest day of the numbers. */
export function dayWords(day: string, today: string): string {
  if (day === today) return 'Today'
  const yesterday = dateOf(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (day === localDay(yesterday)) return 'Yesterday'
  return LONG.format(dateOf(day))
}

/** The newest `count` days, oldest first. */
export const lastDays = (days: readonly MetricsDay[], count: number): MetricsDay[] => (count > 0 ? days.slice(-count) : [])

const COUNTS = Object.keys(emptyMetricsDay('')).filter((key) => key !== 'day') as Exclude<keyof MetricsDay, 'day'>[]

/** Every count of `days` added up, as one day named by the first of them. */
export function sumDays(days: readonly MetricsDay[]): MetricsDay {
  const total = emptyMetricsDay(days[0]?.day ?? '')
  for (const day of days) {
    for (const key of COUNTS) total[key] += day[key]
  }
  return total
}

/** A run of days a line chart draws as one point. */
export interface DayFold {
  from: string
  to: string
  days: readonly MetricsDay[]
  /** Every count of the run added up. Its `day` is `from`. */
  total: MetricsDay
}

/**
 * Days folded into runs of `size`, counted back from the newest day so the newest run is whole and only the oldest
 * may be short. Oldest first.
 */
export function foldDays(days: readonly MetricsDay[], size: number): DayFold[] {
  const folds: DayFold[] = []
  const step = Math.max(1, Math.floor(size))
  for (let end = days.length; end > 0; end -= step) {
    const run = days.slice(Math.max(0, end - step), end)
    folds.unshift({ from: run[0]!.day, to: run.at(-1)!.day, days: run, total: sumDays(run) })
  }
  return folds
}

/** The weekly fold of a line chart. */
export const weeksOf = (days: readonly MetricsDay[]): DayFold[] => foldDays(days, 7)

/** The days a tile's figure and sparkline cover. */
export const TILE_DAYS = 30

/** The six tiles of Work and of a project's page, in their order. */
export type TileKey = 'waiting' | 'merged' | 'first-pass' | 'by-itself' | 'ai-reviews' | 'tokens'

/** What one tile shows: a label, the figure, one line of context, and a 30-day sparkline. */
export interface Tile {
  key: TileKey
  label: string
  /** The figure, or "no data yet". */
  figure: string
  /** Smaller words after the figure: "of 100M", "running". */
  after?: string
  /** One line of context under the figure. */
  context: string
  /** A sentence that says what the tile counts and what its bars are. */
  counts: string
  /** One value for each of the last 30 days, oldest first. Null where a rate has nothing under it. */
  series: readonly (number | null)[]
  /** The most a bar of the sparkline can be: 1 for a share, the largest value otherwise. */
  most?: number
}

/** What the tiles read. Each part is null while it is not known. */
export interface TilesInput {
  /** The numbers by day, oldest first; the newest is today. Only the last 30 count. */
  days: readonly MetricsDay[] | null
  /** Finished changes waiting for the user now, and how long the oldest has waited. */
  waiting: { count: number; oldestMs: number | null } | null
  /** The AI reviews as their list says now. */
  reviews: { running: number; ready: number; failed: number } | null
  /** Today's fresh tokens and the day's allowance (`tokensToday`, `dailyTokens`). */
  tokens: { today: number | null; limit: number | null } | null
  /** "today" for Work; "period" for a project's page, whose second tile counts the 30 days. */
  merged?: 'today' | 'period'
}

const shareOf = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null)
const merges = (day: MetricsDay) => day.mergedByItself + day.mergedByYou

/** The waiting tile's line: none waiting, or how long the oldest has waited when the host says. */
function waitingContext(waiting: TilesInput['waiting']): string {
  if (!waiting) return ''
  if (waiting.count === 0) return 'none waiting'
  if (waiting.oldestMs === null) return 'oldest unknown'
  return `oldest ${spanWords(waiting.oldestMs)}`
}

/** The tokens tile's figure, with the day's allowance after it when there is one. */
function tokensFigure(today: number | null, limit: number | null | undefined): Pick<Tile, 'figure' | 'after'> {
  if (today === null) return { figure: NO_DATA }
  if (!limit) return { figure: tokenWords(today) }
  return { figure: tokenWords(today), after: `of ${tokenWords(limit)}` }
}

/** The six tiles in their order, with their words, from what Work knows. */
export function workTiles(input: TilesInput): Tile[] {
  const known = input.days
  const days = known ? lastDays(known, TILE_DAYS) : []
  const series = (pick: (day: MetricsDay) => number | null): (number | null)[] => {
    const values = days.map(pick)
    return [...Array<null>(TILE_DAYS - values.length).fill(null), ...values]
  }
  const rates = ratesOf(days)
  const decided = rates.merged + days.reduce((total, day) => total + day.declined, 0)
  const today = days.at(-1) ?? null
  const period = input.merged === 'period'
  const mergedDays = period ? days : today ? [today] : []
  const merged = mergedDays.reduce((total, day) => total + merges(day), 0)
  const mergedByItself = mergedDays.reduce((total, day) => total + day.mergedByItself, 0)
  const nothingMerged = period ? 'nothing in 30 days' : 'nothing yet today'
  const tokensToday = input.tokens?.today ?? today?.tokens ?? null

  return [
    {
      key: 'waiting',
      label: 'Waiting for you',
      figure: input.waiting ? countWords(input.waiting.count) : NO_DATA,
      context: waitingContext(input.waiting),
      counts: 'Finished changes waiting for your yes or no now. The bars are the changes that finished each day, over 30 days.',
      series: series((day) => day.finished),
    },
    {
      key: 'merged',
      label: period ? 'Merged (30 d)' : 'Merged today',
      figure: known ? countWords(merged) : NO_DATA,
      context: !known ? '' : merged === 0 ? nothingMerged : `${countWords(mergedByItself)} by itself`,
      counts: `Changes merged ${period ? 'over 30 days' : 'today'}, by itself or on your yes. The bars are the merges of each day, over 30 days.`,
      series: series(merges),
    },
    {
      key: 'first-pass',
      label: 'First pass',
      figure: known ? shareWords(rates.firstPassRate) : NO_DATA,
      context: !known ? '' : decided === 0 ? 'nothing decided yet' : `of ${countWords(decided)} decided`,
      counts: 'Of the changes merged or declined over 30 days, the share never sent back first. The bars are that share for each day.',
      series: series((day) => shareOf(day.firstPass, merges(day) + day.declined)),
      most: 1,
    },
    {
      key: 'by-itself',
      label: 'By itself',
      figure: known ? shareWords(rates.byItselfShare) : NO_DATA,
      context: !known ? '' : rates.merged === 0 ? 'nothing merged yet' : `of ${countWords(rates.merged)} merged`,
      counts: 'Of the changes merged over 30 days, the share hobkin merged by itself in YOLO mode. The bars are that share for each day.',
      series: series((day) => shareOf(day.mergedByItself, merges(day))),
      most: 1,
    },
    {
      key: 'ai-reviews',
      label: 'Reviews',
      ...(input.reviews ? { figure: countWords(input.reviews.running), after: 'running' } : { figure: NO_DATA }),
      context: input.reviews ? `${countWords(input.reviews.ready)} ready · ${countWords(input.reviews.failed)} failed` : '',
      counts: 'Reviews running now, and those ready or stopped. The bars are the reviews that answered each day, over 30 days.',
      series: series((day) => day.reviewsSafe + day.reviewsRisky),
    },
    {
      key: 'tokens',
      label: 'Tokens today',
      ...tokensFigure(tokensToday, input.tokens?.limit),
      context: tokensToday === null ? '' : 'resets at midnight',
      counts: "Fresh tokens work mode spent today, of the day's allowance. The bars are the tokens of each day, over 30 days.",
      series: series((day) => day.tokens),
    },
  ]
}
