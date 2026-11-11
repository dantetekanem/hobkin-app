import assert from 'node:assert/strict'
import { test } from 'node:test'
import { needsAttention, outcomeWeek, sinceLastLook } from '../src/features/reports/briefing.ts'
import type { Report } from '../src/features/reports/report.ts'

const NOW = new Date(2026, 10, 10, 12, 0).getTime()
const HOUR = 3_600_000
const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString()
const report = (id: string, hours: number, scheduleId: string, body = 'A report.', outcome = 'completed'): Report => ({
  id, title: `Title of ${scheduleId}`, scheduleId, at: ago(hours), body, outcome,
})

// Newest first, as the screen lists them.
const LIST: Report[] = [
  report('recap-1', 1, 'morning-recap', 'Useful: two things.'),
  report('deps-2', 2, 'dependency-look', 'Useful: one advisory.'),
  report('deps-1', 3, 'dependency-look', 'Critical: a vulnerable package.'),
  report('watch-1', 4, 'status-watch', 'Nothing new.'),
  report('redirect', 5, 'work.storefront.do', 'Fixed the loop.'),
  report('backup', 30, 'backup-check', '', 'failed'),
  report('recap-0', 26, 'morning-recap', 'Critical: read already.'),
]

test('unread reports are counted by where they came from, the most urgent first', () => {
  const sources = needsAttention(LIST, new Set(['recap-0']))
  assert.deepEqual(sources.map(({ key }) => key), ['dependency-look', 'backup-check', 'morning-recap', 'storefront'])
  const deps = sources[0]!
  assert.deepEqual([deps.unread, deps.worst, deps.worstCount, deps.openId], [2, 'critical', 1, 'deps-1'], 'opens the worst one, not the newest')
  assert.equal(deps.label, 'Title of dependency-look', 'a routine is named by its title')
  assert.equal(sources[3]!.label, 'storefront', 'work is named by its project')
  assert.ok(!sources.some(({ key }) => key === 'status-watch'), 'nothing new needs nothing')
})

test('among equally serious sources, more of the worst comes first', () => {
  const list = [report('a1', 1, 'a', 'Useful: x.'), report('b1', 2, 'b', 'Useful: x.'), report('b2', 3, 'b', 'Useful: y.')]
  assert.deepEqual(needsAttention(list, new Set()).map(({ key }) => key), ['b', 'a'])
})

test('what is new is counted from the last look: the latest read hobkin saw or the newest report read', () => {
  const read = new Set(['redirect'])
  const fromReport = sinceLastLook(LIST, read, undefined)
  assert.equal(fromReport?.since, NOW - 5 * HOUR)
  assert.deepEqual([fromReport?.count, fromReport?.worst, fromReport?.openId], [4, 'critical', 'deps-1'])

  const attention = [{ lastReadAt: ago(2.5) }, { lastReadAt: null }, { lastReadAt: 'not a date' }, 'junk']
  const fromHost = sinceLastLook(LIST, read, attention)
  assert.equal(fromHost?.since, NOW - 2.5 * HOUR, 'a later read hobkin recorded wins')
  assert.deepEqual([fromHost?.count, fromHost?.worst, fromHost?.openId], [2, 'useful', 'recap-1'])
})

test('with nothing ever read there is no last look', () => {
  assert.equal(sinceLastLook(LIST, new Set(), []), null)
})

test('the week of runs counts how each day ended, oldest day first, and opens the worst of a day', () => {
  const list = [
    report('today-ok', 1, 'a'),
    report('today-stopped', 2, 'a', '', 'incomplete'),
    report('yesterday-fail', 30, 'b', '', 'failed'),
    report('yesterday-ok', 31, 'b'),
    report('long-ago', 24 * 9, 'c'),
  ]
  const days = outcomeWeek(list, NOW)
  assert.equal(days.length, 7)
  assert.deepEqual(days.map(({ today }) => today), [false, false, false, false, false, false, true])
  const [yesterday, today] = days.slice(-2)
  assert.deepEqual([today!.completed, today!.failed, today!.stopped, today!.openId], [1, 0, 1, 'today-stopped'])
  assert.deepEqual([yesterday!.completed, yesterday!.failed, yesterday!.stopped, yesterday!.openId], [1, 1, 0, 'yesterday-fail'])
  assert.equal(days.reduce((sum, day) => sum + day.completed + day.failed + day.stopped, 0), 4, 'older runs are left out')
  assert.equal(days[0]!.openId, null)
})
