import { ratesOf, type MetricsDay, type MetricsSeries, type MetricsSpan, type WorkMetrics } from '#shared/protocol/metrics.ts'
import { SERIES_COLOR, type DaySeries, type ProjectRow, type RatePoint } from './chart-kit.ts'
import { foldDays, lastDays, shareWords, spanWords, sumDays, tokenWords, type TileKey } from './format.ts'

/** The Numbers tab's charts, as data (_specs/053-work-control-room, the Numbers sketch). Pure, so it can be tested. */

/** The periods the Numbers tab switches between, in days. */
export const NUMBERS_PERIODS = [7, 30, 90] as const
export type NumbersPeriod = (typeof NUMBERS_PERIODS)[number]

/** A chart of the Numbers tab. Each has the element id `numbers-<chart>`. */
export type NumbersChart = 'merged' | 'first-pass' | 'waiting' | 'start-to-merge' | 'ai-reviews' | 'proofs' | 'tokens' | 'projects'

/** What a click on the Numbers tab opens: the list a chart counts (on one day or run of days when one was picked), or a project. */
export type NumbersOpen = { chart: NumbersChart; from?: string; to?: string } | { project: string }

/** The chart of the Numbers tab each of Work's tiles opens at. */
export const TILE_CHART: Record<TileKey, NumbersChart> = {
  waiting: 'waiting',
  merged: 'merged',
  'first-pass': 'first-pass',
  'by-itself': 'merged',
  'ai-reviews': 'ai-reviews',
  tokens: 'tokens',
}

/** The element id of a chart, so a page can bring it into view. */
export const chartId = (chart: NumbersChart): string => `numbers-${chart}`

export interface Board {
  /** The days drawn, oldest first; the newest is today. */
  days: string[]
  merged: { series: DaySeries[]; line: DaySeries; figure: string }
  firstPass: { points: RatePoint[]; figure: string }
  waiting: MetricsSpan
  startToMerge: MetricsSpan
  aiReview: MetricsSpan
  reviews: { series: DaySeries[]; figure: string }
  proofs: { series: DaySeries[]; figure: string }
  tokens: { series: DaySeries[]; figure: string }
}

function seriesOf(days: readonly MetricsDay[], key: string, label: string, color: string, pick: (day: MetricsDay) => number): DaySeries {
  return { key, label, color, values: days.map(pick) }
}

/** A rate line's points: by day over a week, by week over longer. */
function firstPassPoints(days: readonly MetricsDay[], period: number): RatePoint[] {
  return foldDays(days, period <= 7 ? 1 : 7).map(({ from, to, days: run }) => {
    const total = sumDays(run)
    const count = total.mergedByItself + total.mergedByYou + total.declined
    return { from, to, rate: ratesOf(run).firstPassRate, count }
  })
}

/** Everything the Numbers tab draws for the last `period` days of `series` (all projects unless one is given). */
export function boardOf(metrics: WorkMetrics, period: NumbersPeriod, series: MetricsSeries = metrics.all): Board {
  const days = lastDays(series.days, period)
  const rates = ratesOf(days)
  const total = sumDays(days)
  const answerTime = series.spans.aiReview.median
  const perMergedWords = rates.tokensPerMerged === null ? '' : ` · ${tokenWords(rates.tokensPerMerged)} per merged change`

  return {
    days: days.map((day) => day.day),
    merged: {
      series: [
        seriesOf(days, 'itself', 'by itself', SERIES_COLOR.itself, (day) => day.mergedByItself),
        seriesOf(days, 'you', 'by you', SERIES_COLOR.you, (day) => day.mergedByYou),
      ],
      line: seriesOf(days, 'declined', 'declined', SERIES_COLOR.declined, (day) => day.declined),
      figure: rates.merged ? `${rates.merged} merged · ${shareWords(rates.byItselfShare)} by itself` : 'nothing merged yet',
    },
    firstPass: { points: firstPassPoints(days, period), figure: shareWords(rates.firstPassRate) },
    waiting: series.spans.waitForYou,
    startToMerge: series.spans.startToMerge,
    aiReview: series.spans.aiReview,
    reviews: {
      series: [
        seriesOf(days, 'safe', 'safe', SERIES_COLOR.good, (day) => day.reviewsSafe),
        seriesOf(days, 'risky', 'risky', SERIES_COLOR.risky, (day) => day.reviewsRisky),
        seriesOf(days, 'failed', 'stopped', SERIES_COLOR.quiet, (day) => day.reviewsFailed),
      ],
      figure: answerTime === null ? 'answer time: no data yet' : `median ${spanWords(answerTime)} to answer`,
    },
    proofs: {
      series: [
        seriesOf(days, 'holds', 'hold', SERIES_COLOR.good, (day) => day.proofsHold),
        seriesOf(days, 'broken', 'broken', SERIES_COLOR.broken, (day) => day.proofsBroken),
      ],
      figure: `${total.proofsHold} hold · ${total.proofsBroken} broken`,
    },
    tokens: {
      series: [seriesOf(days, 'tokens', 'tokens', SERIES_COLOR.plain, (day) => day.tokens)],
      figure: `${tokenWords(total.tokens)}${perMergedWords}`,
    },
  }
}

/** The table of projects over the last `period` days, the most merged first and those with nothing yet last. */
export function projectRows(metrics: WorkMetrics, period: NumbersPeriod): ProjectRow[] {
  return metrics.projects
    .map((project) => {
      const days = lastDays(project.days, period)
      const rates = ratesOf(days)
      return {
        slug: project.slug,
        name: project.name,
        merged: rates.merged,
        byItself: rates.byItselfShare,
        firstPass: rates.firstPassRate,
        wait: project.spans.waitForYou.median,
        series: days.map((day) => day.mergedByItself + day.mergedByYou),
      }
    })
    .sort((a, b) => b.merged - a.merged)
}
