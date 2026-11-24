import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentSchedule } from '#shared/protocol/schedules.ts'
import { readAgentSchedules } from '#shared/protocol/schedules.ts'
import { countdown, everyWords, leftWords, scheduleLine, whenWords } from '../src/features/schedules/schedules.ts'

// A schedule's agent says how long it lives, how often it fires and how many wakes it has, with no most (056, 2026-11-24).
const NOW = Date.parse('2026-11-24T15:00:00.000Z')
const at = (ms: number) => new Date(NOW + ms).toISOString()
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const daily: AgentSchedule = {
  id: 'd1',
  owner: { kind: 'main' },
  name: 'Look at the job',
  does: 'shell',
  command: 'bin/job-status',
  every: 24 * 3600,
  state: 'waiting',
  nextAt: at(2 * DAY + 3 * HOUR),
  until: at(3 * DAY),
  runs: 1,
  wakes: 0,
  maxWakes: 12,
}

test('a countdown of a day or more reads in days and hours, and one under a day reads as a clock as before', () => {
  assert.equal(countdown(3 * DAY), '3 d')
  assert.equal(countdown(2 * DAY + 3 * HOUR + 5 * MINUTE), '2 d 3 h')
  assert.equal(countdown(DAY - SECOND), '23:59:59')
  assert.equal(whenWords(daily, NOW), 'in 2 d 3 h')
  assert.equal(scheduleLine([daily], NOW)?.text, 'Look at the job in 2 d 3 h')
})

test('how often a schedule fires reads in hours and days past an hour', () => {
  assert.equal(everyWords(6 * 3600), 'every 6 h')
  assert.equal(everyWords(24 * 3600), 'every day')
  assert.equal(everyWords(36 * 3600), 'every 1 d 12 h')
  assert.equal(everyWords(7 * 24 * 3600), 'every 7 d')
  assert.equal(everyWords(90 * 60), 'every 1 h 30 min')
  assert.equal(everyWords(3600), 'every hour', 'as before')
  assert.equal(everyWords(120), 'every 2 min', 'as before')
})

test('what a schedule has left reads in days, and one with no end says so', () => {
  assert.equal(leftWords(daily, NOW), '3 d left')
  assert.equal(leftWords({ ...daily, until: at(DAY + 12 * HOUR), maxRuns: 24 }, NOW), '23 runs and 1 d 12 h left')
  const endless = { ...daily, until: undefined }
  assert.equal(leftWords(endless, NOW), 'no end')
  assert.equal(leftWords({ ...endless, maxRuns: 24 }, NOW), '23 runs left, no end')
})

test('the contract reads a schedule with no end and no cap on wakes without either, and a day long interval as it is', () => {
  const [read] = readAgentSchedules([{ id: 'd2', state: 'waiting', every: 86400, nextAt: at(DAY), runs: 0, wakes: 3, until: null, maxWakes: null }])!
  assert.deepEqual([read!.every, read!.until, read!.maxWakes, read!.wakes], [86400, undefined, undefined, 3])
})
