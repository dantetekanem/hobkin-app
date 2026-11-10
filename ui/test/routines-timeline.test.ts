import assert from 'node:assert/strict'
import { test } from 'node:test'
import { instantOf, nextRun, nextSevenDays, occurrencesBetween, timesOfDay } from '../src/features/routines/timeline.ts'
import type { Routine } from '../src/features/routines/types.ts'

const TORONTO = 'America/Toronto'
const NEW_YORK = 'America/New_York'

function routine(overrides: Partial<Routine> = {}): Routine {
  const base: Routine = {
    id: 'recap',
    title: 'Morning recap',
    at: '09:00',
    timezone: TORONTO,
    enabled: true,
    harness: 'pi',
    model: null,
    effort: 'medium',
    cwd: '/Users/sample/notes',
    context: [],
    cadence: 'daily',
    path: '/Users/sample/.hobkin/routines/daily/recap.md',
    prompt: 'Say what changed.',
  }
  const made = { ...base, ...overrides }
  // A routine has a time or a window, never both.
  if (overrides.window) delete made.at
  return made
}

const at = (iso: string) => Date.parse(iso)
const iso = (instant: number | null | undefined) => (instant == null ? null : new Date(instant).toISOString())
const next = (item: Routine, now: string) => iso(nextRun(item, at(now))?.at)

test('a daily routine runs today while its time is ahead, and tomorrow once it has passed', () => {
  const daily = routine()

  assert.equal(next(daily, '2026-11-09T08:00:00-05:00'), '2026-11-09T14:00:00.000Z')
  assert.equal(next(daily, '2026-11-09T09:00:00-05:00'), '2026-11-10T14:00:00.000Z', 'the time itself is no longer ahead')
  assert.equal(next(daily, '2026-11-09T22:40:00-05:00'), '2026-11-10T14:00:00.000Z')
})

test('a routine with several times runs at each of them, in order', () => {
  const several = routine({ at: ['18:00', '09:00', '12:00'] })

  assert.deepEqual(timesOfDay(several), ['09:00', '12:00', '18:00'])
  assert.equal(next(several, '2026-11-09T10:00:00-05:00'), '2026-11-09T17:00:00.000Z')
  assert.equal(next(several, '2026-11-09T12:00:00-05:00'), '2026-11-09T23:00:00.000Z')
  assert.equal(next(several, '2026-11-09T18:00:00-05:00'), '2026-11-10T14:00:00.000Z')
})

test('a weekly routine runs on its weekdays', () => {
  const wednesday = routine({ cadence: 'weekly', weekday: 3, at: '14:00' })
  assert.equal(next(wednesday, '2026-11-09T22:40:00-05:00'), '2026-11-11T19:00:00.000Z')
  assert.equal(next(wednesday, '2026-11-11T14:00:00-05:00'), '2026-11-18T19:00:00.000Z', 'a week later once it has run')

  const mondayAndThursday = routine({ cadence: 'weekly', weekday: [1, 4], at: '08:30' })
  assert.equal(next(mondayAndThursday, '2026-11-09T22:40:00-05:00'), '2026-11-12T13:30:00.000Z')
  assert.equal(next(mondayAndThursday, '2026-11-12T09:00:00-05:00'), '2026-11-16T13:30:00.000Z')
})

test('a monthly routine skips a month that has no such day', () => {
  const lastDay = routine({ cadence: 'monthly', day: 31, at: '07:00' })
  assert.equal(next(lastDay, '2026-11-09T22:40:00-05:00'), '2026-12-31T12:00:00.000Z', 'November has 30 days')

  const thirtieth = routine({ cadence: 'monthly', day: 30, at: '07:00' })
  assert.equal(next(thirtieth, '2026-01-31T12:00:00-05:00'), '2026-03-30T11:00:00.000Z', 'February has no 30th')
})

test('a once routine runs on its date and never again', () => {
  const once = routine({ cadence: 'once', date: '2026-11-12', at: '15:00' })

  assert.equal(next(once, '2026-11-09T22:40:00-05:00'), '2026-11-12T20:00:00.000Z')
  assert.equal(next(once, '2026-11-12T15:00:00-05:00'), null)
  assert.equal(next(once, '2027-01-01T00:00:00-05:00'), null)
})

test('a window routine runs at every step of its window', () => {
  const hourly = routine({ window: { start: '08:00', end: '17:00', everyMinutes: 60 } })

  assert.deepEqual(timesOfDay(hourly), ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'])
  assert.equal(next(hourly, '2026-11-10T10:30:00-05:00'), '2026-11-10T16:00:00.000Z')
  assert.equal(next(hourly, '2026-11-10T17:00:00-05:00'), '2026-11-11T13:00:00.000Z', 'nothing starts after the end')

  // The end is a check only when it falls on a step.
  assert.deepEqual(timesOfDay(routine({ window: { start: '08:00', end: '09:00', everyMinutes: 25 } })), ['08:00', '08:25', '08:50'])
})

test("every time is a wall-clock time in the routine's own timezone", () => {
  const now = '2026-11-09T22:40:00-05:00'

  assert.equal(next(routine({ timezone: 'Europe/Lisbon' }), now), '2026-11-10T09:00:00.000Z')
  assert.equal(next(routine({ timezone: 'Asia/Tokyo' }), now), '2026-11-11T00:00:00.000Z', 'it is already past 09:00 on the 10th in Tokyo')
  assert.equal(next(routine({ timezone: 'America/Sao_Paulo' }), now), '2026-11-10T12:00:00.000Z')
})

test('a daylight saving change keeps the wall-clock time', () => {
  const daily = routine({ timezone: NEW_YORK })

  // Clocks go back on November 1, 2026: the 09:00 run comes 25 hours after the one before it.
  assert.equal(next(daily, '2026-10-31T08:00:00-04:00'), '2026-10-31T13:00:00.000Z')
  assert.equal(next(daily, '2026-10-31T12:00:00-04:00'), '2026-11-01T14:00:00.000Z')
  // Clocks go forward on March 8, 2026: the 09:00 run comes 23 hours after the one before it.
  assert.equal(next(daily, '2026-03-07T08:00:00-05:00'), '2026-03-07T14:00:00.000Z')
  assert.equal(next(daily, '2026-03-07T12:00:00-05:00'), '2026-03-08T13:00:00.000Z')
})

test('a time the clocks skip is not run that day', () => {
  const early = routine({ timezone: NEW_YORK, at: '02:30' })

  assert.equal(instantOf(NEW_YORK, { year: 2026, month: 3, day: 8 }, '02:30'), null, '02:30 does not happen on March 8')
  assert.equal(next(early, '2026-03-07T12:00:00-05:00'), '2026-03-09T06:30:00.000Z')
})

test('a time the clocks repeat runs once, the first time', () => {
  const early = routine({ timezone: NEW_YORK, at: '01:30' })

  assert.equal(next(early, '2026-10-31T12:00:00-04:00'), '2026-11-01T05:30:00.000Z', 'the first 01:30, before the clocks go back')
  assert.equal(next(early, '2026-11-01T05:31:00.000Z'), '2026-11-02T06:30:00.000Z', 'the second 01:30 is not a run')
})

test('a routine that is off has no next run and no occurrences', () => {
  const off = routine({ enabled: false })

  assert.equal(nextRun(off, at('2026-11-09T08:00:00-05:00')), null)
  assert.deepEqual(occurrencesBetween(off, at('2026-11-09T00:00:00-05:00'), at('2026-11-16T00:00:00-05:00')), [])
})

test('occurrences between two times come in order, after the first and up to the second', () => {
  const daily = routine()
  const found = occurrencesBetween(daily, at('2026-11-09T09:00:00-05:00'), at('2026-11-12T09:00:00-05:00'))

  assert.deepEqual(
    found.map((occurrence) => [occurrence.date, occurrence.time, iso(occurrence.at)]),
    [
      ['2026-11-10', '09:00', '2026-11-10T14:00:00.000Z'],
      ['2026-11-11', '09:00', '2026-11-11T14:00:00.000Z'],
      ['2026-11-12', '09:00', '2026-11-12T14:00:00.000Z'],
    ],
  )
})

const WEEK: Routine[] = [
  routine({ id: 'recap', at: '09:00' }),
  routine({ id: 'night', at: '23:30' }),
  routine({ id: 'lisbon', cadence: 'weekly', weekday: 3, at: '15:00', timezone: 'Europe/Lisbon' }),
  routine({ id: 'bills', cadence: 'monthly', day: 15, at: '07:00' }),
  routine({ id: 'rent', cadence: 'monthly', day: 20, at: '07:00' }),
  routine({ id: 'dentist', cadence: 'once', date: '2026-11-12', at: '15:00' }),
  routine({ id: 'paused', at: '10:00', enabled: false }),
  routine({ id: 'inbox', cadence: 'weekly', weekday: [1, 2, 3, 4, 5], window: { start: '08:00', end: '17:00', everyMinutes: 60 } }),
]

test('places occurrences in the next seven days', () => {
  // Monday night in Toronto.
  const days = nextSevenDays(WEEK, at('2026-11-09T22:40:00-05:00'), TORONTO)

  assert.deepEqual(
    days.map((day) => [day.date, day.entries.map((entry) => entry.routineId)]),
    [
      ['2026-11-09', ['night']],
      ['2026-11-10', ['inbox', 'recap', 'night']],
      ['2026-11-11', ['inbox', 'recap', 'lisbon', 'night']],
      ['2026-11-12', ['inbox', 'recap', 'dentist', 'night']],
      ['2026-11-13', ['inbox', 'recap', 'night']],
      ['2026-11-14', ['recap', 'night']],
      ['2026-11-15', ['bills', 'recap', 'night']],
    ],
  )

  const wednesday = days[2]!
  assert.equal(iso(wednesday.start), '2026-11-11T05:00:00.000Z', 'a day starts at midnight where the user is')
  const lisbon = wednesday.entries.find((entry) => entry.routineId === 'lisbon')!
  assert.equal(iso(lisbon.at), '2026-11-11T15:00:00.000Z', 'at its real time')
  assert.deepEqual([lisbon.date, lisbon.time], ['2026-11-11', '15:00'], "and it keeps the date and time of the routine's own timezone")

  const dentist = days[3]!.entries.find((entry) => entry.routineId === 'dentist')!
  assert.equal(iso(dentist.at), '2026-11-12T20:00:00.000Z')
})

test('a window shows as one entry a day, with its start, its end and every check', () => {
  const days = nextSevenDays(WEEK, at('2026-11-09T22:40:00-05:00'), TORONTO)
  const inbox = days[1]!.entries.find((entry) => entry.routineId === 'inbox')!

  assert.equal(days.flatMap((day) => day.entries).filter((entry) => entry.routineId === 'inbox').length, 4, 'Tuesday to Friday')
  assert.equal(iso(inbox.at), '2026-11-10T13:00:00.000Z')
  assert.equal(inbox.window?.start, '08:00')
  assert.equal(inbox.window?.end, '17:00')
  assert.equal(inbox.window?.everyMinutes, 60)
  assert.equal(inbox.window?.checks.length, 10)
  assert.equal(iso(inbox.window?.checks.at(-1)), '2026-11-10T22:00:00.000Z')
})

test('a window that has started shows the checks it has left', () => {
  const days = nextSevenDays(WEEK, at('2026-11-10T10:30:00-05:00'), TORONTO)
  const inbox = days[0]!.entries.find((entry) => entry.routineId === 'inbox')!

  assert.equal(inbox.key, 'inbox:2026-11-10:window')
  assert.equal(inbox.time, '11:00', 'its next check')
  assert.equal(iso(inbox.at), '2026-11-10T16:00:00.000Z')
  assert.equal(inbox.window?.checks.length, 7)
  assert.equal(inbox.window?.start, '08:00', 'the window itself is still shown whole')
})

test('a held routine has no occurrences until its hold ends', () => {
  const now = at('2026-11-09T22:40:00-05:00')
  const days = nextSevenDays(WEEK, now, TORONTO, { recap: { until: '2026-11-11T18:00:00.000Z', reason: 'The notes folder is missing.' } })
  const recapDays = days.filter((day) => day.entries.some((entry) => entry.routineId === 'recap')).map((day) => day.date)

  assert.deepEqual(recapDays, ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'], 'Tuesday and Wednesday morning fall inside the hold')
})

test('an entry keeps its key when its time changes, so it can be seen moving', () => {
  const now = at('2026-11-09T22:40:00-05:00')
  const before = nextSevenDays([routine({ id: 'recap', at: '09:00' })], now, TORONTO)[1]!.entries[0]!
  const after = nextSevenDays([routine({ id: 'recap', at: '11:15' })], now, TORONTO)[1]!.entries[0]!

  assert.equal(before.key, 'recap:2026-11-10:0')
  assert.equal(after.key, before.key)
  assert.equal(iso(after.at), '2026-11-10T16:15:00.000Z')
})

test('the seven days follow the calendar where the user is, across a daylight saving change', () => {
  // Saturday, the day before the clocks go back in Toronto.
  const days = nextSevenDays([routine()], at('2026-10-31T12:00:00-04:00'), TORONTO)

  assert.equal(days.length, 7)
  assert.equal(iso(days[0]!.start), '2026-10-31T04:00:00.000Z')
  assert.equal(iso(days[1]!.start), '2026-11-01T04:00:00.000Z')
  assert.equal(iso(days[2]!.start), '2026-11-02T05:00:00.000Z', 'November 1 is 25 hours long')
  assert.deepEqual(days.map((day) => day.entries.length), [0, 1, 1, 1, 1, 1, 1], 'today at 09:00 has passed')
  assert.equal(iso(days[1]!.entries[0]!.at), '2026-11-01T14:00:00.000Z')
})
