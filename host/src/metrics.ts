/**
 * Work in numbers (_specs/053-work-control-room): hobkin folds its own records by local day (`src/cli/work/metrics.mjs`
 * in hobkin), and the host adds what only it keeps, the AI reviews, then keeps the answer for a minute. Neither reads
 * the other's files. Read with `work.metrics`.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dayOf, spanOf, workMetrics } from 'hobkin/src/cli/work/metrics.mjs'
import { METRICS_DAYS_DEFAULT, type MetricsDay, type MetricsSeries, type WorkMetrics } from '#shared/protocol/metrics.ts'
import { deployOf, type AssessmentSummary } from '#shared/review/assessment.ts'
import { reviewIdOf, type ReviewTarget } from '#shared/review/ids.ts'
import type { ReviewList } from '#shared/review/status.ts'
import type { HostHandlers } from './commands.ts'
import { assessmentFolder } from './review/assessment.ts'
import { reviewStore } from './review/store.ts'

/** How long one answer stands. The window asks again at most once a minute while a page with numbers shows. */
export const METRICS_KEPT_MS = 60_000

export interface MetricsSeat {
  /** hobkin's data folder, where its records are. Throws, with the reason, while hobkin is not open in this host. */
  data: () => string
  /** The host's root, where the window's reviews are kept, under `client/reviews/`. */
  root: string
  /** The reviews as AI Reviews lists them, to tell a change review under way from one that stopped before its answer. */
  reviews?: { list(): ReviewList }
  /** hobkin's own fold. A fake in tests. */
  fold?: (home: string, options: { days: number; now: number }) => WorkMetrics
  now?: () => number
}

/** What the change review writes as it runs (`review-progress/1`), as far as the numbers need it. */
interface ReviewProgress {
  started_at?: string
  updated_at?: string
}

type ReviewCount = 'reviewsSafe' | 'reviewsRisky' | 'reviewsFailed'

const UNDER_WAY = new Set(['queued', 'running'])
const UNREADABLE = Symbol('unreadable')
/** A review keeps each commit's AI review in a folder named by the commit's first 12 characters. */
const folderHead = (head: string) => head.slice(0, 12)

/** A file's JSON, undefined when there is no such file, or `UNREADABLE`. */
function readKept<Value>(file: string): Value | undefined | typeof UNREADABLE {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : UNREADABLE
  }
  try {
    const value = JSON.parse(text) as unknown
    return value && typeof value === 'object' ? (value as Value) : UNREADABLE
  } catch {
    return UNREADABLE
  }
}

/** Each change review waiting or under way, as `<review id>@<its commit's folder>`. Nothing when the list cannot be read. */
function underWayIn(reviews: MetricsSeat['reviews']): Set<string> {
  try {
    const listed = reviews?.list().reviews ?? []
    return new Set(
      listed.flatMap(({ id, assessment }) => (assessment?.head && UNDER_WAY.has(assessment.state) ? [`${id}@${folderHead(assessment.head)}`] : [])),
    )
  } catch {
    return new Set()
  }
}

/**
 * The AI reviews laid onto hobkin's fold, in place: each answer on the local day it came, each review that stopped
 * before one and that nothing runs now on the day it last moved, and, for each answer, how long it took from its start.
 * A finished change counts for its project, and a pull request only for all projects together.
 */
function addReviews(metrics: WorkMetrics, root: string, underWay: Set<string>): WorkMetrics {
  const place = new Map(metrics.all.days.map(({ day }, index) => [day, index]))
  const projects = new Map(metrics.projects.map((project) => [project.slug, project]))
  const took = new Map<MetricsSeries, number[]>([[metrics.all, []], ...metrics.projects.map((project): [MetricsSeries, number[]] => [project, []])])
  const seriesOf = (target: ReviewTarget) => [metrics.all, ...(target.kind === 'change' && projects.has(target.slug) ? [projects.get(target.slug)!] : [])]
  const count = (target: ReviewTarget, time: string | undefined, name: ReviewCount, ms?: number) => {
    const index = time ? place.get(dayOf(time)) : undefined
    if (index === undefined) return
    for (const series of seriesOf(target)) {
      ;(series.days[index] as MetricsDay)[name] += 1
      if (ms !== undefined && ms >= 0) took.get(series)!.push(ms)
    }
  }

  let stored: ReturnType<ReturnType<typeof reviewStore>['list']>
  try {
    stored = reviewStore(root).list()
  } catch {
    metrics.gaps.push('The AI reviews could not be read, so none of them is counted.')
    return metrics
  }
  for (const { target } of stored) {
    const id = reviewIdOf(target)
    const folder = dirname(assessmentFolder(root, target, '0'.repeat(40)))
    let heads: string[]
    try {
      heads = readdirSync(folder)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') metrics.gaps.push(`The AI reviews of ${id} could not be read, so they are not counted.`)
      continue
    }
    for (const head of heads) {
      const summary = readKept<AssessmentSummary>(join(folder, head, 'summary.json'))
      const progress = readKept<ReviewProgress>(join(folder, head, 'progress.json'))
      if (summary === UNREADABLE || progress === UNREADABLE) {
        metrics.gaps.push(`The AI review of ${id} at ${head.slice(0, 7)} could not be read, so it is not counted.`)
        continue
      }
      const startedAt = Date.parse(progress?.started_at ?? '')
      if (summary) count(target, summary.at, deployOf(summary) === 'risky' ? 'reviewsRisky' : 'reviewsSafe', Number.isFinite(startedAt) ? Date.parse(summary.at) - startedAt : undefined)
      else if (progress && !underWay.has(`${id}@${head}`)) count(target, progress.updated_at ?? progress.started_at, 'reviewsFailed')
    }
  }
  for (const [series, durations] of took) series.spans = { ...series.spans, aiReview: spanOf(durations) }
  return metrics
}

/** Work's numbers for the last `days` local days, folded again only once the last answer is a minute old or for another period. */
export function metricsReader(seat: MetricsSeat): (days?: number) => WorkMetrics {
  const now = seat.now ?? Date.now
  const fold = seat.fold ?? ((home: string, options: { days: number; now: number }) => workMetrics(home, options))
  let kept: { key: string; at: number; value: WorkMetrics } | null = null
  return (days = METRICS_DAYS_DEFAULT) => {
    const home = seat.data()
    const key = `${home}\0${days}`
    const time = now()
    if (kept?.key === key && time - kept.at < METRICS_KEPT_MS) return kept.value
    const value = addReviews(fold(home, { days, now: time }), seat.root, underWayIn(seat.reviews))
    kept = { key, at: time, value }
    return value
  }
}

/** `work.metrics`, which only reads. */
export function metricsHandlers(seat: MetricsSeat): Pick<HostHandlers, 'work.metrics'> {
  const read = metricsReader(seat)
  return { 'work.metrics': ({ days }) => read(days) }
}
