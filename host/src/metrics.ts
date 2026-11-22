/**
 * Work in numbers (_specs/053-work-control-room): hobkin folds its own records by local day (`src/cli/work/metrics.mjs`
 * in hobkin), and the host adds what only it keeps, the AI reviews, then keeps each period's answer for a minute.
 * Neither reads the other's files. Read with `work.metrics`.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { METRICS_DAYS_DEFAULT, METRICS_OLDER_RUNTIME, type MetricsSeries, type WorkMetrics } from '#shared/protocol/metrics.ts'
import { deployOf, type AssessmentSummary } from '#shared/review/assessment.ts'
import { reviewIdOf, type ReviewTarget } from '#shared/review/ids.ts'
import type { ReviewList } from '#shared/review/status.ts'
import { Unavailable, type HostHandlers } from './commands.ts'
import { assessmentFolder } from './review/assessment.ts'
import { reviewStore, type ReviewStore } from './review/store.ts'

/** How long one answer stands. The window asks again at most once a minute while a page with numbers shows. */
export const METRICS_KEPT_MS = 60_000

/** What `work.metrics` says when the hobkin on this Mac is older than its numbers. */
export const OLDER_RUNTIME = METRICS_OLDER_RUNTIME

type MetricsModule = typeof import('hobkin/src/cli/work/metrics.mjs')

/** hobkin's own fold and its rules for days and spans, each present only when the hobkin on this Mac has it. */
export type MetricsRuntime = Partial<Pick<MetricsModule, 'workMetrics' | 'dayOf' | 'spanOf'>>

const METRICS_MODULE = 'hobkin/src/cli/work/metrics.mjs'
const FUNCTIONS = ['workMetrics', 'dayOf', 'spanOf'] as const

/** hobkin's metrics functions through a dynamic import, so a hobkin without them leaves the host working. */
export async function loadMetricsRuntime(specifier: string = METRICS_MODULE): Promise<MetricsRuntime> {
  let module: Record<string, unknown>
  try {
    module = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>
  } catch {
    return {}
  }
  const present = FUNCTIONS.filter((name) => typeof module[name] === 'function')
  return Object.fromEntries(present.map((name) => [name, module[name]])) as MetricsRuntime
}

export interface MetricsSeat {
  /** hobkin's data folder, where its records are. Throws, with the reason, while hobkin is not open in this host. */
  data: () => string
  /** The host's root, where the window's reviews are kept, under `client/reviews/`. */
  root: string
  /** The reviews as AI Reviews lists them, to tell a change review under way from one that stopped before its answer. */
  reviews?: { list(): ReviewList }
  /** hobkin's own functions. A fake fold in tests. */
  runtime?: () => Promise<MetricsRuntime>
  now?: () => number
}

type Rules = Required<Pick<MetricsRuntime, 'dayOf' | 'spanOf'>>

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
    const underWay = listed.flatMap(({ id, assessment }) => {
      if (!assessment?.head || !UNDER_WAY.has(assessment.state)) return []
      return [`${id}@${folderHead(assessment.head)}`]
    })
    return new Set(underWay)
  } catch {
    return new Set()
  }
}

/**
 * The AI reviews laid onto hobkin's fold, in place: each answer on the local day it came, each review that stopped
 * before one and that nothing runs now on the day it last moved, and, for each answer, how long it took from its start.
 * A finished change counts for its project, and a pull request only for all projects together.
 */
function addReviews(metrics: WorkMetrics, root: string, store: ReviewStore, underWay: Set<string>, { dayOf, spanOf }: Rules): WorkMetrics {
  const dayIndex = new Map(metrics.all.days.map(({ day }, index) => [day, index]))
  const projects = new Map(metrics.projects.map((project) => [project.slug, project]))
  const took = new Map([metrics.all, ...metrics.projects].map((series): [MetricsSeries, number[]] => [series, []]))
  const seriesOf = (target: ReviewTarget): MetricsSeries[] => {
    const project = target.kind === 'change' ? projects.get(target.slug) : undefined
    return project ? [metrics.all, project] : [metrics.all]
  }
  const count = (target: ReviewTarget, time: string | undefined, name: ReviewCount, ms?: number) => {
    const index = time ? dayIndex.get(dayOf(time)) : undefined
    if (index === undefined) return
    for (const series of seriesOf(target)) {
      series.days[index][name] += 1
      if (ms !== undefined && ms >= 0) took.get(series)!.push(ms)
    }
  }

  let stored: ReturnType<ReviewStore['list']>
  try {
    stored = store.list()
  } catch {
    metrics.gaps.push('The AI reviews could not be read, so none of them is counted.')
    return metrics
  }
  for (const { target } of stored) {
    const id = reviewIdOf(target)
    // The folder that holds one AI review for each reviewed commit.
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
      if (summary) {
        const startedAt = Date.parse(progress?.started_at ?? '')
        const tookMs = Number.isFinite(startedAt) ? Date.parse(summary.at) - startedAt : undefined
        count(target, summary.at, deployOf(summary) === 'risky' ? 'reviewsRisky' : 'reviewsSafe', tookMs)
      } else if (progress && !underWay.has(`${id}@${head}`)) {
        count(target, progress.updated_at ?? progress.started_at, 'reviewsFailed')
      }
    }
  }
  for (const [series, durations] of took) {
    series.spans = { ...series.spans, aiReview: spanOf(durations) }
  }
  return metrics
}

/**
 * Work's numbers for the last `days` local days. Each period asked for keeps its own answer for a minute, so a window
 * that switches between periods folds each at most once a minute. Throws `Unavailable` when hobkin has no fold.
 */
export function metricsReader(seat: MetricsSeat): (days?: number) => Promise<WorkMetrics> {
  const now = seat.now ?? Date.now
  const runtime = seat.runtime ?? loadMetricsRuntime
  const kept = new Map<string, { at: number; value: WorkMetrics }>()
  // One store for every read, so a review file read once is not parsed again until it changes.
  const store = reviewStore(seat.root)
  return async (days = METRICS_DAYS_DEFAULT) => {
    const home = seat.data()
    const key = `${home}\0${days}`
    const time = now()
    for (const [old, { at }] of kept) {
      if (time - at >= METRICS_KEPT_MS) kept.delete(old)
    }
    const known = kept.get(key)
    if (known) return known.value

    const { workMetrics, dayOf, spanOf } = await runtime()
    if (!workMetrics || !dayOf || !spanOf) throw new Unavailable(OLDER_RUNTIME)
    const folded = workMetrics(home, { days, now: time })
    const value = addReviews(folded, seat.root, store, underWayIn(seat.reviews), { dayOf, spanOf })
    kept.set(key, { at: time, value })
    return value
  }
}

/** `work.metrics`, which only reads. */
export function metricsHandlers(seat: MetricsSeat): Pick<HostHandlers, 'work.metrics'> {
  const read = metricsReader(seat)
  return { 'work.metrics': ({ days }) => read(days) }
}
