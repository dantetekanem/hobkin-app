import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clockText, costText, dayWord, durationText, errorFile, errorText, holdEnds, howOften, ownTime, untilText, whenText, zoneText } from '../src/features/routines/words.ts'
import type { Routine } from '../src/features/routines/types.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const NOW = Date.parse('2026-11-09T22:40:00-05:00')
const TORONTO = 'America/Toronto'

function routine(overrides: Partial<Routine>): Routine {
  const made: Routine = {
    id: 'r',
    title: 'R',
    at: '09:00',
    timezone: TORONTO,
    enabled: true,
    harness: 'pi',
    model: null,
    effort: 'medium',
    cwd: '/Users/sample',
    context: [],
    cadence: 'daily',
    path: '/Users/sample/.hobkin/routines/daily/r.md',
    prompt: 'x',
    ...overrides,
  }
  if (overrides.window) delete made.at
  return made
}

test('how long until a run, the way a person says it', () => {
  assert.equal(untilText(NOW + 30_000, NOW), 'in under a minute')
  assert.equal(untilText(NOW + 42 * MINUTE + 50_000, NOW), 'in 42 min')
  assert.equal(untilText(NOW + 3 * HOUR, NOW), 'in 3 h')
  assert.equal(untilText(NOW + 10 * HOUR + 14 * MINUTE, NOW), 'in 10 h 14 min')
  assert.equal(untilText(NOW + DAY, NOW), 'in 1 day')
  assert.equal(untilText(NOW + DAY + 2 * HOUR + 10 * MINUTE, NOW), 'in 1 day 2 h')
  assert.equal(untilText(NOW + 2 * DAY + 5 * HOUR, NOW), 'in 2 days')
  assert.equal(untilText(NOW + 51 * DAY, NOW), 'in 51 days')
  assert.equal(untilText(NOW - 5_000, NOW), 'now', 'a time that has just passed')
})

test('how long a run took, and what it cost', () => {
  assert.equal(durationText(0), '0 s')
  assert.equal(durationText(42), '42 s')
  assert.equal(durationText(185), '3 min 5 s')
  assert.equal(durationText(120), '2 min')
  assert.equal(durationText(3_720), '1 h 2 min')
  assert.equal(costText(0.18), '$0.18')
  assert.equal(costText(2), '$2.00')
  assert.equal(costText(null), 'not reported')
})

test('how often a routine runs, in words', () => {
  assert.equal(howOften(routine({})), 'Every day at 09:00')
  assert.equal(howOften(routine({ at: ['09:00', '13:00'] })), 'Every day at 09:00 and 13:00')
  assert.equal(howOften(routine({ at: ['09:00', '12:00', '18:00'] })), 'Every day at 09:00, 12:00 and 18:00')
  assert.equal(howOften(routine({ window: { start: '08:00', end: '17:00', everyMinutes: 60 } })), 'Every day from 08:00 to 17:00, every hour')
  assert.equal(howOften(routine({ window: { start: '08:00', end: '12:00', everyMinutes: 20 } })), 'Every day from 08:00 to 12:00, every 20 min')
  assert.equal(howOften(routine({ cadence: 'weekly', weekday: 3, at: '14:00' })), 'Every Wednesday at 14:00')
  assert.equal(howOften(routine({ cadence: 'weekly', weekday: [4, 1], at: '08:30' })), 'Every Monday and Thursday at 08:30')
  assert.equal(howOften(routine({ cadence: 'weekly', weekday: [1, 2, 3, 4, 5], at: '08:30' })), 'Monday to Friday at 08:30')
  assert.equal(howOften(routine({ cadence: 'monthly', day: 1, at: '07:00' })), 'The 1st of every month at 07:00')
  assert.equal(howOften(routine({ cadence: 'monthly', day: 22, at: '07:00' })), 'The 22nd of every month at 07:00')
  assert.equal(howOften(routine({ cadence: 'monthly', day: 13, at: '07:00' })), 'The 13th of every month at 07:00')
  assert.equal(howOften(routine({ cadence: 'once', date: '2026-11-12', at: '15:00' })), 'Once, on Nov 12, 2026 at 15:00')
})

test("a time reads as a clock time and a day in the timezone it is asked for", () => {
  const run = Date.parse('2026-11-10T14:00:00.000Z')

  assert.equal(clockText(run, TORONTO), '09:00')
  assert.equal(clockText(run, 'Europe/Lisbon'), '14:00')
  assert.equal(whenText(run, TORONTO, NOW), 'tomorrow 09:00')
  assert.equal(whenText(NOW + 30 * MINUTE, TORONTO, NOW), 'today 23:10')
  assert.equal(whenText(Date.parse('2026-11-12T20:00:00.000Z'), TORONTO, NOW), 'Thu 15:00')
  assert.equal(whenText(Date.parse('2026-12-01T12:00:00.000Z'), TORONTO, NOW), 'Tue, Dec 1, 07:00', 'more than a week away gets its date')
  assert.equal(whenText(Date.parse('2026-11-09T14:00:00.000Z'), TORONTO, NOW), 'today 09:00')
  assert.equal(whenText(Date.parse('2026-11-08T14:00:00.000Z'), TORONTO, NOW), 'yesterday 09:00')
  assert.equal(whenText(Date.parse('2026-11-05T14:00:00.000Z'), TORONTO, NOW), 'Thu, Nov 5, 09:00')
  // The same instant is already tomorrow in Tokyo.
  assert.equal(whenText(NOW + 30 * MINUTE, 'Asia/Tokyo', NOW), 'today 13:10')
})

test("a routine's time is given in its own timezone, with the time here when that is another one", () => {
  const run = Date.parse('2026-11-10T17:30:00.000Z')

  assert.equal(ownTime(run, 'Europe/Lisbon', TORONTO), '17:30 Portugal Time, 12:30 here')
  assert.equal(ownTime(run, TORONTO, TORONTO), '12:30')
  assert.equal(zoneText('Europe/Lisbon', run), 'Portugal Time')
  assert.equal(zoneText('Not/AZone', run), 'Not/AZone', 'a name the Mac does not know is shown as written')
})

test('a hold is shown ending on the next whole minute, never before it really ends', () => {
  assert.equal(new Date(holdEnds('2026-11-12T12:45:58.000Z')).toISOString(), '2026-11-12T12:46:00.000Z')
  assert.equal(new Date(holdEnds('2026-11-12T12:46:00.000Z')).toISOString(), '2026-11-12T12:46:00.000Z')
})

test('a day reads as today, tomorrow, a weekday within the week, and a date beyond it', () => {
  assert.equal(dayWord(NOW + 30 * MINUTE, TORONTO, NOW), 'today')
  assert.equal(dayWord(Date.parse('2026-11-10T14:00:00.000Z'), TORONTO, NOW), 'tomorrow')
  assert.equal(dayWord(Date.parse('2026-11-12T20:00:00.000Z'), TORONTO, NOW), 'Thursday')
  assert.equal(dayWord(Date.parse('2026-12-01T12:00:00.000Z'), TORONTO, NOW), 'Tue, Dec 1')
  assert.equal(dayWord(Date.parse('2026-11-08T14:00:00.000Z'), TORONTO, NOW), 'yesterday')
  assert.equal(dayWord(Date.parse('2026-11-05T14:00:00.000Z'), TORONTO, NOW), 'Thu, Nov 5')
})

test("a definition error names its file from the home down, and says what is wrong once", () => {
  const error = { path: '/Users/sample/.hobkin/routines/weekly/inbox-sweep.md', message: '/Users/sample/.hobkin/routines/weekly/inbox-sweep.md: unknown setting: schedule' }

  assert.equal(errorFile(error), 'routines/weekly/inbox-sweep.md')
  assert.equal(errorText(error), 'unknown setting: schedule')
  assert.equal(errorText({ path: '/Users/sample/.hobkin/routines/daily/recap-copy.md', message: 'duplicate routine id: recap' }), 'duplicate routine id: recap')
  assert.equal(errorFile({ path: '/somewhere/else/file.md', message: 'x' }), '/somewhere/else/file.md', 'a path outside a routines folder is shown whole')
})
