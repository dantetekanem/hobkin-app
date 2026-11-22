import type { DecidedChange } from '#shared/protocol/metrics.ts'
import type { NumbersChart, NumbersOpen } from '../numbers/board-model.ts'
import { dayWords, localDay, shortDay } from '../numbers/format.ts'

/**
 * What a click on the Numbers tab opens (_specs/053-work-control-room, "Numbers"): the changes a chart counts, the AI
 * Reviews tab, or a project's page. A chart with nothing behind it opens nothing. Pure, so it is tested alone.
 */

/** The charts whose list is the changes merged or declined (`WorkMetrics.decided`). */
export type ListedChart = 'merged' | 'first-pass' | 'waiting' | 'start-to-merge'

/** The list a chart asks for: its chart, and the day or run of days picked, or the whole period. */
export interface DecidedAsk {
  chart: ListedChart
  from?: string
  to?: string
}

export type ChartTarget = { list: DecidedAsk } | { tab: 'reviews' } | { project: string } | null

const LISTED: ReadonlySet<NumbersChart> = new Set<ListedChart>(['merged', 'first-pass', 'waiting', 'start-to-merge'])

/** The charts that open something. Only these may look and act like buttons; proofs and tokens have no list behind them. */
export const OPENING_CHARTS: ReadonlySet<NumbersChart> = new Set<NumbersChart>([...LISTED, 'ai-reviews', 'projects'])

export function chartOpens(what: NumbersOpen): ChartTarget {
  if ('project' in what) return { project: what.project }
  if (what.chart === 'ai-reviews') return { tab: 'reviews' }
  if (!LISTED.has(what.chart)) return null
  return { list: { chart: what.chart as ListedChart, ...(what.from ? { from: what.from } : {}), ...(what.to ? { to: what.to } : {}) } }
}

/** Which changes each chart counts: every one decided, those the user decided (the wait for them), or those merged. */
const COUNTED: Record<ListedChart, readonly DecidedChange['outcome'][]> = {
  merged: ['merged-by-itself', 'merged-by-you', 'declined'],
  'first-pass': ['merged-by-itself', 'merged-by-you', 'declined'],
  waiting: ['merged-by-you', 'declined'],
  'start-to-merge': ['merged-by-itself', 'merged-by-you'],
}

const HEADING: Record<ListedChart, string> = {
  merged: 'Merged and declined',
  'first-pass': 'Decided: first pass or sent back',
  waiting: 'Decided by you',
  'start-to-merge': 'Merged',
}

export interface DecidedList {
  heading: string
  /** The days it covers, in words: "Today", "Nov 15 to today", "the last 30 days". */
  range: string
  /** Newest first. */
  rows: DecidedChange[]
  /** False when the host lists no decided changes at all, as one older than the list. */
  listed: boolean
}

function rangeWords({ from, to = from }: DecidedAsk, today: string, periodDays: number): string {
  if (!from || !to) return `the last ${periodDays} days`
  if (from === to) return dayWords(from, today)
  return `${shortDay(from)} to ${to === today ? 'today' : shortDay(to)}`
}

/** The changes behind a chart, on the day or run of days picked, newest first. `today` is the newest day of the numbers. */
export function decidedList(decided: readonly DecidedChange[] | undefined, ask: DecidedAsk, today: string, periodDays: number): DecidedList {
  const heading = HEADING[ask.chart]
  const range = rangeWords(ask, today, periodDays)
  if (!decided) return { heading, range, rows: [], listed: false }
  const counted = COUNTED[ask.chart]
  const within = (change: DecidedChange) => {
    const day = localDay(Date.parse(change.at))
    return (!ask.from || day >= ask.from) && (!ask.to || day <= ask.to)
  }
  const rows = decided.filter((change) => counted.includes(change.outcome) && within(change)).toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at))
  return { heading, range, rows, listed: true }
}

const OUTCOME: Record<DecidedChange['outcome'], string> = {
  'merged-by-itself': 'merged by itself',
  'merged-by-you': 'merged by you',
  declined: 'declined',
}

/** How a change was decided, and whether it was the first pass: "merged by you · sent back 2 times". */
export function decidedWords({ outcome, sentBack }: DecidedChange): string {
  const pass = sentBack === 0 ? 'first pass' : sentBack === 1 ? 'sent back once' : `sent back ${sentBack} times`
  return `${OUTCOME[outcome]} · ${pass}`
}
