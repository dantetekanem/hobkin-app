import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { emptyMetricsDay, type MetricsSeries, type WorkMetrics } from '#shared/protocol/metrics.ts'
import type { ReviewList } from '#shared/review/status.ts'
import { checkArguments, COMMANDS } from '#shared/commands/registry.ts'
import { runCommand } from '../src/commands.ts'
import { dayOf, spanOf } from 'hobkin/src/cli/work/metrics.mjs'
import { loadMetricsRuntime, metricsHandlers, metricsReader, METRICS_KEPT_MS, OLDER_RUNTIME, type MetricsRuntime } from '../src/metrics.ts'
import { temporaryDirectory } from './support.ts'

// Every time is local, so the days come out the same in any time zone. Today is 21 November 2026, at 15:00.
const NOW = new Date(2026, 10, 21, 15).getTime()
const HOUR = 3_600_000
const daysAgo = (days: number, hour = 12) => new Date(2026, 10, 21 - days, hour).toISOString()
const dayName = (days: number) => new Date(2026, 10, 21 - days, 12).toLocaleDateString('en-CA')
const noSpan = { median: null, p90: null, count: 0 }

/** hobkin's fold as the runtime answers it: a week of empty days, for all projects and for API and Web, with a gap of its own. */
function fakeFold(calls: { home: string; days: number; now: number }[] = []) {
  return (home: string, { days = 30, now = NOW }: { days?: number; now?: number } = {}): WorkMetrics => {
    const options = { days, now }
    calls.push({ home, ...options })
    const series = (): MetricsSeries => ({
      days: Array.from({ length: options.days }, (_, index) => emptyMetricsDay(dayName(options.days - 1 - index))),
      spans: { waitForYou: { median: HOUR, p90: HOUR, count: 1 }, startToMerge: noSpan, aiReview: noSpan },
    })
    return {
      from: dayName(options.days - 1),
      to: dayName(0),
      at: new Date(options.now).toISOString(),
      all: series(),
      projects: [
        { slug: 'api', name: 'API', ...series() },
        { slug: 'web', name: 'Web', ...series() },
      ],
      gaps: ['A line of the record of tokens (work/tokens.jsonl) could not be read, so it is not counted.'],
      decided: [DECIDED_ROW],
    }
  }
}

const DECIDED_ROW = { slug: 'api', item: 'a1', title: 'Fix a1', at: daysAgo(1), outcome: 'merged-by-itself', sentBack: 0, head: 'abc1234' } as const

/** A runtime with hobkin's own day and span rules around a fake fold. */
const runtimeWith = (fold: ReturnType<typeof fakeFold>) => async (): Promise<MetricsRuntime> => ({ workMetrics: fold, dayOf, spanOf })

/** A review the window keeps, and the AI reviews of its commits, each as the change review writes them. */
function writeReview(root: string, folder: string, heads: Record<string, { summary?: unknown; progress?: unknown }>) {
  const reviews = join(root, 'client', 'reviews', folder)
  const write = (file: string, value: unknown) => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
  }
  write(join(reviews, `review-${Object.keys(heads)[0]}.json`), { change: { title: 'A change', project: 'API', head: `${Object.keys(heads)[0]}abcdef` } })
  for (const [head, { summary, progress }] of Object.entries(heads)) {
    if (summary !== undefined) write(join(reviews, 'change-review', head, 'summary.json'), summary)
    if (progress !== undefined) write(join(reviews, 'change-review', head, 'progress.json'), progress)
  }
}

const started = (at: string) => ({ schema: 'review-progress/1', started_at: at, updated_at: at, percent: 0 })
const pick = (days: { [field: string]: unknown }[], field: string) => days.map((day) => day[field])
const lastDays = (series: MetricsSeries, field: 'reviewsSafe' | 'reviewsRisky' | 'reviewsFailed' | 'started', count = 3) => pick(series.days.slice(-count) as never, field)
const projectOf = (metrics: WorkMetrics, slug: string) => metrics.projects.find((project) => project.slug === slug)!

test('work.metrics adds the AI reviews the host keeps to hobkin fold: each answer on its day, one that stopped before it, and how long they took', async (t) => {
  const root = temporaryDirectory(t)
  writeReview(root, 'change+api+a1', {
    aaaaaaaaaaaa: { summary: { level: 'safe', deploy: 'safe', at: daysAgo(1, 13) }, progress: started(daysAgo(1, 12)) },
    bbbbbbbbbbbb: { summary: { level: 'mid', deploy: 'risky', at: daysAgo(0, 14) }, progress: started(daysAgo(0, 11)) },
    // A summary from before the one answer existed says risky by its worst level.
    cccccccccccc: { summary: { level: 'high', at: daysAgo(0, 9) } },
    // It stopped before an answer, and nothing runs it.
    dddddddddddd: { progress: { ...started(daysAgo(2, 10)), updated_at: daysAgo(2, 11) } },
    // Its answer came before the period.
    eeeeeeeeeeee: { summary: { level: 'safe', deploy: 'safe', at: daysAgo(9) }, progress: started(daysAgo(9, 10)) },
  })
  // One under way now is no failure.
  writeReview(root, 'change+web+w1', { ffffffffffff: { progress: started(daysAgo(0, 14)) } })
  // A pull request belongs to no project of work mode's, so it counts for all of them together.
  writeReview(root, 'pr+acme+site+7', { '111111111111': { summary: { level: 'safe', deploy: 'safe', at: daysAgo(1, 18) }, progress: started(daysAgo(1, 16)) } })
  const reviews = {
    list: (): ReviewList => ({
      reviews: [{ id: 'change:web:w1', kind: 'change', title: 'W1', project: 'Web', head: 'ffffffffffff0000', state: 'ready', phase: null, error: null, updatedAt: daysAgo(0), assessment: { state: 'running', head: 'ffffffffffff0000' } }],
    }),
  }
  const calls: { home: string; days: number; now: number }[] = []

  const metrics = await metricsReader({ data: () => '/hobkin-home', root, reviews, runtime: runtimeWith(fakeFold(calls)), now: () => NOW })(3)

  assert.deepEqual(calls, [{ home: '/hobkin-home', days: 3, now: NOW }])
  assert.deepEqual(lastDays(metrics.all, 'reviewsSafe'), [0, 2, 0])
  assert.deepEqual(lastDays(metrics.all, 'reviewsRisky'), [0, 0, 2])
  assert.deepEqual(lastDays(metrics.all, 'reviewsFailed'), [1, 0, 0])
  const api = projectOf(metrics, 'api')
  assert.deepEqual([lastDays(api, 'reviewsSafe'), lastDays(api, 'reviewsRisky'), lastDays(api, 'reviewsFailed')], [[0, 1, 0], [0, 0, 2], [1, 0, 0]])
  const web = projectOf(metrics, 'web')
  assert.deepEqual([lastDays(web, 'reviewsSafe'), lastDays(web, 'reviewsRisky'), lastDays(web, 'reviewsFailed')], [[0, 0, 0], [0, 0, 0], [0, 0, 0]])
  // From each start to its answer: an hour and three hours on API, and two on the pull request.
  assert.deepEqual(metrics.all.spans.aiReview, { median: 2 * HOUR, p90: Math.round(2.8 * HOUR), count: 3 })
  assert.deepEqual(api.spans.aiReview, { median: 2 * HOUR, p90: Math.round(2.8 * HOUR), count: 2 })
  assert.deepEqual(web.spans.aiReview, noSpan)
  // What hobkin folded stays as it was.
  assert.deepEqual(metrics.all.spans.waitForYou, { median: HOUR, p90: HOUR, count: 1 })
  assert.deepEqual(lastDays(metrics.all, 'started'), [0, 0, 0])
  assert.deepEqual(metrics.gaps, ['A line of the record of tokens (work/tokens.jsonl) could not be read, so it is not counted.'])
  assert.deepEqual(metrics.decided, [DECIDED_ROW])
})

test("with hobkin's own fold, a home with nothing yet answers every day of the period with zeros, for all projects and for each", async (t) => {
  const root = temporaryDirectory(t)
  mkdirSync(join(root, 'work'), { recursive: true })
  writeFileSync(join(root, 'work', 'projects.jsonl'), `${JSON.stringify({ slug: 'api', name: 'API', state: 'chosen', level: 'important' })}\n`)
  writeReview(root, 'change+api+a1', { aaaaaaaaaaaa: { summary: { level: 'safe', deploy: 'safe', at: daysAgo(0, 13) }, progress: started(daysAgo(0, 12)) } })

  const metrics = await metricsReader({ data: () => root, root, now: () => NOW })(5)

  assert.deepEqual([metrics.from, metrics.to], [dayName(4), dayName(0)])
  assert.deepEqual(
    metrics.projects.map(({ slug, days }) => [slug, days.map(({ day }) => day)]),
    [['api', [4, 3, 2, 1, 0].map(dayName)]],
  )
  assert.deepEqual(lastDays(projectOf(metrics, 'api'), 'reviewsSafe', 5), [0, 0, 0, 0, 1])
  assert.deepEqual(lastDays(metrics.all, 'started', 5), [0, 0, 0, 0, 0])
  assert.deepEqual(metrics.gaps, [])
  assert.deepEqual(metrics.decided, [])
})

test('an AI review whose files cannot be read is named in gaps, and the rest still count', async (t) => {
  const root = temporaryDirectory(t)
  writeReview(root, 'change+api+a1', {
    aaaaaaaaaaaa: { summary: '{"level": "safe", "at"', progress: started(daysAgo(1)) },
    bbbbbbbbbbbb: { summary: { level: 'safe', deploy: 'safe', at: daysAgo(1, 13) } },
  })

  const metrics = await metricsReader({ data: () => '/hobkin-home', root, runtime: runtimeWith(fakeFold()), now: () => NOW })(3)

  assert.deepEqual(lastDays(metrics.all, 'reviewsSafe'), [0, 1, 0])
  assert.deepEqual(metrics.gaps.slice(1), ['The AI review of change:api:a1 at aaaaaaa could not be read, so it is not counted.'])
})

test('work.metrics is a host command that only reads, for 30 days unless asked and 1 to 180 when asked', async (t) => {
  const root = temporaryDirectory(t)
  const calls: { home: string; days: number; now: number }[] = []
  const handlers = metricsHandlers({ data: () => '/hobkin-home', root, runtime: runtimeWith(fakeFold(calls)), now: () => NOW })

  const outcome = await runCommand(handlers, 'work.metrics', {})

  assert.equal(outcome.ok, true)
  assert.deepEqual(calls.map(({ days }) => days), [30])
  assert.equal(COMMANDS['work.metrics'].runs, 'host')
  assert.equal('outside' in COMMANDS['work.metrics'], false)
  assert.equal(checkArguments('work.metrics', { days: 180 }).ok, true)
  for (const days of [0, 181, 2.5]) assert.equal(checkArguments('work.metrics', { days }).ok, false, String(days))
  assert.equal(checkArguments('work.metrics', { days: 7, project: 'api' }).ok, false)
})

test('each period asked for keeps its own answer for a minute, so switching between periods folds nothing again', async (t) => {
  const root = temporaryDirectory(t)
  const calls: { home: string; days: number; now: number }[] = []
  let now = NOW
  const read = metricsReader({ data: () => '/hobkin-home', root, runtime: runtimeWith(fakeFold(calls)), now: () => now })

  const month = await read()
  const quarter = await read(90)
  now += METRICS_KEPT_MS - 1
  assert.equal(await read(30), month)
  assert.equal(await read(90), quarter)
  now += 1
  const later = await read(30)

  assert.deepEqual(calls.map(({ days }) => days), [30, 90, 30])
  assert.notEqual(later, month)
  assert.deepEqual([month.all.days.length, quarter.all.days.length], [30, 90])
})

test('a hobkin older than work numbers leaves the host working, and work.metrics says this host sends no numbers yet', async (t) => {
  const root = temporaryDirectory(t)
  assert.deepEqual(await loadMetricsRuntime('hobkin/src/cli/work/no-such-module.mjs'), {})
  assert.equal(typeof (await loadMetricsRuntime()).workMetrics, 'function')

  const handlers = metricsHandlers({ data: () => '/hobkin-home', root, runtime: async () => ({}) })

  assert.deepEqual(await runCommand(handlers, 'work.metrics', { days: 7 }), { ok: false, error: { code: 'unavailable', message: OLDER_RUNTIME } })
})
