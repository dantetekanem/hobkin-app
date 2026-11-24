import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  backupSummary, countOf, daysSince, routineCount, engineOf, formatCount, formatDate, formatDuration, formatPercent, formatUsd, refreshRate, tokenTotals,
} from '../src/features/settings/nerd-stats-data.ts'

const scalar = (value: number | null) => (value === null ? { value, state: 'unavailable' as const } : { value, state: 'complete' as const })
const run = (input: number | null, output: number | null, cacheRead: number | null, cacheWrite: number | null, responses: number | null, usd: number | null) => ({
  performance: { input: scalar(input), output: scalar(output), cacheRead: scalar(cacheRead), cacheWrite: scalar(cacheWrite), responses, estimatedUsd: scalar(usd) },
})

test('tokens and cost add up across runs, skipping what was not reported', () => {
  const runs = [run(100, 50, 10, 5, 3, 0.5), run(null, 20, null, null, null, null), { performance: null }] as never
  assert.deepEqual(tokenTotals({ runs }), { input: 100, output: 70, cacheRead: 10, cacheWrite: 5, total: 185, costUsd: 0.5, runs: 3, responses: 3 })
  assert.equal(tokenTotals(null), null)
  assert.equal(tokenTotals({ runs: [] })?.costUsd, null)
})

test('backups summarise to count, size, newest and oldest', () => {
  assert.deepEqual(backupSummary([{ at: 5, bytes: 10 }, { at: 2, bytes: 30 }]), { count: 2, bytes: 40, newest: 5, oldest: 2 })
  assert.deepEqual(backupSummary([]), { count: 0, bytes: 0, newest: null, oldest: null })
})

test('durations, days, counts, engine and refresh rate read plainly', () => {
  assert.equal(formatDuration(65), '1m 05s')
  assert.equal(formatDuration(3 * 3600 + 7 * 60), '3h 07m')
  assert.equal(formatDuration(2 * 86400 + 4 * 3600), '2d 04h')
  assert.equal(daysSince('2026-11-02T00:00:00Z', Date.parse('2026-11-12T12:00:00Z')), 10)
  assert.equal(daysSince(null, 0), null)
  assert.equal(countOf([1, 2]), 2)
  assert.equal(countOf(undefined), null)
  assert.equal(routineCount([{ id: 'morning' }, { id: 'echo/digest', integration: 'echo' }, { id: 'weekly' }]), 2, "an integration's workflows are not the user's routines")
  assert.equal(routineCount(undefined), null)
  assert.equal(engineOf('Mozilla/5.0 AppleWebKit/537.36 (KHTML) Chrome/131.0.6778.86 Safari/537.36'), 'Chrome 131.0.6778.86')
  assert.equal(engineOf('Mozilla/5.0 AppleWebKit/605.1.15 (KHTML, like Gecko)'), 'AppleWebKit/605.1.15')
  assert.equal(refreshRate(Array(20).fill(8.4)), 120)
  assert.equal(refreshRate(Array(20).fill(16.8)), 60)
  assert.equal(refreshRate([16]), null)
  assert.equal(formatUsd(0.1234), '$0.123')
  assert.equal(formatUsd(12.345), '$12.35')
  assert.equal(formatUsd(null), '—')
})

test('numbers read short', () => {
  assert.equal(formatPercent(12.4), '12%')
  assert.equal(formatPercent(null), '—')
  assert.equal(formatCount(950), '950')
  assert.equal(formatCount(12_345), '12.3k')
  assert.equal(formatCount(4_200_000), '4.2M')
  assert.equal(formatDate(null), '—')
  assert.equal(formatDate('2026-11-02T14:08:32.000Z'), '2 November 2026')
})
