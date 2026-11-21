import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ratesOf, type MetricsDay } from '#shared/protocol/metrics.ts'
import { localDay, sumDays } from '../src/features/numbers/format.ts'
import { SAMPLE_DAYS, sampleMetrics } from '../src/features/numbers/sample-metrics.ts'
import { sampleWork } from '../src/features/work/sample.ts'

const TODAY = new Date(2026, 10, 21, 15, 30)
const busy = (day: MetricsDay) => Object.entries(day).some(([key, value]) => key !== 'day' && value !== 0)

test('the sample is the same on every read', () => {
  assert.deepEqual(sampleMetrics(90, TODAY), sampleMetrics(90, TODAY))
  assert.deepEqual(sampleMetrics(30, TODAY).all.days, sampleMetrics(90, TODAY).all.days.slice(-30))
})

test('the sample has one day for each day of the period, ending today, for all projects and for each', () => {
  for (const days of [7, 30, 90, 180]) {
    const metrics = sampleMetrics(days, TODAY)
    assert.equal(metrics.all.days.length, days)
    assert.equal(metrics.to, '2026-11-21')
    assert.equal(metrics.all.days.at(-1)!.day, '2026-11-21')
    assert.equal(metrics.from, metrics.all.days[0]!.day)
    for (const project of metrics.projects) assert.deepEqual(project.days.map((day) => day.day), metrics.all.days.map((day) => day.day))
  }
  const days = sampleMetrics(90, TODAY).all.days.map((day) => day.day)
  for (let index = 1; index < days.length; index += 1) {
    const next = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - (days.length - 1 - index))
    assert.equal(days[index], localDay(next))
  }
  assert.equal(SAMPLE_DAYS, 90)
})

test("the sample's projects are Work's sample projects, by slug and name", () => {
  const work = new Map(sampleWork(TODAY.getTime()).projects.map((project) => [project.slug, project.name]))
  const projects = sampleMetrics(30, TODAY).projects
  assert.ok(projects.length >= 3)
  for (const project of projects) assert.equal(work.get(project.slug), project.name, project.slug)
})

test('all projects together is the sum of each project, day by day', () => {
  const metrics = sampleMetrics(90, TODAY)
  metrics.all.days.forEach((day, index) => {
    assert.deepEqual(day, { ...sumDays(metrics.projects.map((project) => project.days[index]!)), day: day.day })
  })
})

test('the sample has a few empty days, one bad week, and one project with nothing yet', () => {
  const metrics = sampleMetrics(90, TODAY)
  const empty = metrics.all.days.filter((day) => !busy(day))
  assert.ok(empty.length >= 2 && empty.length <= 6, `${empty.length} empty days`)

  const rate = (days: MetricsDay[]) => ratesOf(days).firstPassRate ?? 1
  const weeks = Array.from({ length: 12 }, (_, week) => metrics.all.days.slice(90 - 7 * (week + 1), 90 - 7 * week))
  const sorted = weeks.map(rate).sort((a, b) => a - b)
  assert.ok(sorted[0]! < sorted[1]! - 0.15, `the worst week ${sorted[0]} stands out from the next ${sorted[1]}`)
  assert.equal(metrics.all.days.reduce((total, day) => total + day.regressed, 0), 1)

  const nothing = metrics.projects.filter((project) => !project.days.some(busy))
  assert.equal(nothing.length, 1)
  assert.deepEqual(nothing[0]!.spans, { waitForYou: { median: null, p90: null, count: 0 }, startToMerge: { median: null, p90: null, count: 0 }, aiReview: { median: null, p90: null, count: 0 } })
})

test("the sample's spans are measured over the period read, median under p90", () => {
  const week = sampleMetrics(7, TODAY).all.spans
  const quarter = sampleMetrics(90, TODAY).all.spans
  assert.ok(quarter.waitForYou.count > week.waitForYou.count)
  for (const span of [week.waitForYou, week.startToMerge, week.aiReview, quarter.waitForYou]) {
    assert.ok(span.median !== null && span.p90 !== null && span.median <= span.p90)
  }
  const merged = sampleMetrics(7, TODAY).all.days.reduce((total, day) => total + day.mergedByItself + day.mergedByYou, 0)
  assert.equal(week.startToMerge.count, merged)
})

test("today matches Work's sample: 7 merged, 4 by itself, 38M tokens", () => {
  const today = sampleMetrics(30, TODAY).all.days.at(-1)!
  assert.equal(today.mergedByItself + today.mergedByYou, 7)
  assert.equal(today.mergedByItself, 4)
  assert.equal(today.tokens, sampleWork(TODAY.getTime()).tokensToday)
})
