import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boardOf, projectRows } from '../src/features/numbers/board-model.ts'
import { columnAt, niceMax, stepColumn, ticksOf } from '../src/features/numbers/chart-kit.ts'
import { sumDays } from '../src/features/numbers/format.ts'
import { sampleMetrics } from '../src/features/numbers/sample-metrics.ts'

const TODAY = new Date(2026, 10, 21, 15, 30)

test('the board draws the days of its period, the newest last', () => {
  const metrics = sampleMetrics(90, TODAY)
  for (const period of [7, 30, 90] as const) {
    const board = boardOf(metrics, period)
    assert.equal(board.days.length, period)
    assert.equal(board.days.at(-1), '2026-11-21')
    for (const series of [...board.merged.series, board.merged.line, ...board.reviews.series, ...board.proofs.series, ...board.tokens.series]) assert.equal(series.values.length, period, series.key)
  }
  const month = boardOf(metrics, 30)
  const total = sumDays(metrics.all.days.slice(-30))
  assert.deepEqual(
    month.merged.series.map((series) => series.values.reduce((sum, value) => sum + value, 0)),
    [total.mergedByItself, total.mergedByYou],
  )
})

test('the first pass line is weekly for 30 and 90 days and daily for 7, and a point with nothing decided has a gap', () => {
  const metrics = sampleMetrics(90, TODAY)
  assert.equal(boardOf(metrics, 7).firstPass.points.length, 7)
  assert.equal(boardOf(metrics, 30).firstPass.points.length, 5)
  assert.equal(boardOf(metrics, 90).firstPass.points.length, 13)
  const days = boardOf(metrics, 90).firstPass.points
  assert.equal(days.reduce((sum, point) => sum + point.count, 0), sumDays(metrics.all.days).mergedByItself + sumDays(metrics.all.days).mergedByYou + sumDays(metrics.all.days).declined)
  const quiet = boardOf(sampleMetrics(180, TODAY), 90)
  assert.ok(quiet.firstPass.points.every((point) => (point.count === 0) === (point.rate === null)))
  const empty = boardOf({ ...metrics, all: metrics.projects.find((project) => project.slug === 'design-kit')! }, 30)
  assert.ok(empty.firstPass.points.every((point) => point.rate === null && point.count === 0))
  assert.equal(empty.firstPass.figure, 'no data yet')
})

test('the projects table puts the project with nothing yet last, and its rates read "no data yet"', () => {
  const rows = projectRows(sampleMetrics(30, TODAY), 30)
  assert.deepEqual(rows.map((row) => row.slug), ['storefront', 'billing-api', 'docs-site', 'design-kit'])
  assert.deepEqual(rows.at(-1), { slug: 'design-kit', name: 'design-kit', merged: 0, byItself: null, firstPass: null, wait: null, series: Array(30).fill(0) })
  assert.ok(rows[0]!.merged > 0 && rows[0]!.byItself !== null && rows[0]!.wait !== null)
})

test('a count axis tops at a round number whose half is whole', () => {
  assert.equal(niceMax(0), 1)
  assert.equal(niceMax(1), 1)
  assert.equal(niceMax(5), 6)
  assert.equal(niceMax(10), 10)
  assert.equal(niceMax(11), 20)
  assert.equal(niceMax(48_000_000), 60_000_000)
  assert.deepEqual(ticksOf(6), [0, 3, 6])
  assert.deepEqual(ticksOf(1), [0, 1])
})

test('the pointer and Left and Right find a day of the chart, held inside it', () => {
  assert.equal(columnAt(0, 300, 30), 0)
  assert.equal(columnAt(299.9, 300, 30), 29)
  assert.equal(columnAt(400, 300, 30), 29)
  assert.equal(stepColumn('ArrowLeft', null, 30), 29)
  assert.equal(stepColumn('ArrowLeft', 0, 30), 0)
  assert.equal(stepColumn('ArrowRight', 29, 30), 29)
  assert.equal(stepColumn('ArrowRight', 3, 30), 4)
  assert.equal(stepColumn('Enter', 3, 30), null)
})
