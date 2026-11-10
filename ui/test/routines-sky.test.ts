import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fractionAt, rollingSpan, skyMarks, spanOf, sunHeight } from '../src/features/routines/sky-math.ts'
import type { Routine, RunLine } from '../src/features/routines/types.ts'

const TORONTO = 'America/Toronto'
const at = (iso: string) => Date.parse(iso)
const iso = (instant: number) => new Date(instant).toISOString()
const close = (actual: number, expected: number, message?: string) => assert.ok(Math.abs(actual - expected) < 1e-9, message ?? `${actual} is not ${expected}`)

function routine(overrides: Partial<Routine> = {}): Routine {
  const made: Routine = {
    id: 'recap',
    title: 'Morning recap',
    at: '09:00',
    timezone: TORONTO,
    enabled: true,
    harness: 'pi',
    model: null,
    effort: 'medium',
    cwd: '/Users/sample',
    context: [],
    cadence: 'daily',
    path: '/Users/sample/.hobkin/routines/daily/recap.md',
    prompt: 'x',
    ...overrides,
  }
  if (overrides.window) delete made.at
  return made
}

test('the day shown runs from midnight to midnight where the user is', () => {
  const span = spanOf(at('2026-11-09T22:40:00-05:00'), TORONTO, 1)

  assert.equal(iso(span.start), '2026-11-09T05:00:00.000Z')
  assert.equal(iso(span.end), '2026-11-10T05:00:00.000Z')
  assert.deepEqual(span.days.map(iso), ['2026-11-09T05:00:00.000Z', '2026-11-10T05:00:00.000Z'])
})

test('the week shown is today and the six days after it', () => {
  const span = spanOf(at('2026-11-09T22:40:00-05:00'), TORONTO, 7)

  assert.equal(span.days.length, 8)
  assert.equal(iso(span.start), '2026-11-09T05:00:00.000Z')
  assert.equal(iso(span.end), '2026-11-16T05:00:00.000Z')
})

test('a time sits at its share of the span', () => {
  const day = spanOf(at('2026-11-09T22:40:00-05:00'), TORONTO, 1)
  close(fractionAt(day, at('2026-11-09T00:00:00-05:00')), 0)
  close(fractionAt(day, at('2026-11-09T12:00:00-05:00')), 0.5)
  close(fractionAt(day, at('2026-11-09T18:00:00-05:00')), 0.75)

  const week = spanOf(at('2026-11-09T22:40:00-05:00'), TORONTO, 7)
  close(fractionAt(week, at('2026-11-10T12:00:00-05:00')), 1.5 / 7)
})

test('the sun is highest at noon, at the horizon at six, and lowest at midnight', () => {
  const day = spanOf(at('2026-11-09T22:40:00-05:00'), TORONTO, 1)

  close(sunHeight(day, at('2026-11-09T12:00:00-05:00')), 1)
  close(sunHeight(day, at('2026-11-09T06:00:00-05:00')), 0)
  close(sunHeight(day, at('2026-11-09T18:00:00-05:00')), 0)
  close(sunHeight(day, at('2026-11-09T00:00:00-05:00')), -1)

  const week = spanOf(at('2026-11-09T22:40:00-05:00'), TORONTO, 7)
  close(sunHeight(week, at('2026-11-12T12:00:00-05:00')), 1, 'every day of the week has its own noon')
})

test('the rolling day shows the hours just past and the hours ahead, with now a third of the way along', () => {
  const now = at('2026-11-09T22:40:00-05:00')
  const span = rollingSpan(now, TORONTO, 8, 16)

  assert.equal(iso(span.start), '2026-11-09T19:40:00.000Z')
  assert.equal(iso(span.end), '2026-11-10T19:40:00.000Z')
  close(fractionAt(span, now), 1 / 3)
  assert.deepEqual(span.days.map(iso), ['2026-11-09T05:00:00.000Z', '2026-11-10T05:00:00.000Z', '2026-11-11T05:00:00.000Z'], 'the midnights it crosses, for the sun')
  close(sunHeight(span, at('2026-11-10T12:00:00-05:00')), 1, "tomorrow's noon")
  close(sunHeight(span, at('2026-11-10T00:00:00-05:00')), -1)
})

test('a day the clocks change is still one day wide', () => {
  // November 1, 2026 is 25 hours long in Toronto.
  const day = spanOf(at('2026-11-01T12:00:00-05:00'), TORONTO, 1)

  assert.equal((day.end - day.start) / 3_600_000, 25)
  close(fractionAt(day, at('2026-11-01T12:00:00-05:00')), 13 / 25)
})

const NOW = at('2026-11-09T15:00:00-05:00')
const LOG: RunLine[] = [
  { finishedAt: '2026-11-08T14:01:00.000Z', trigger: 'scheduled', status: 'completed', seconds: 60, usd: 0.1, summary: 'Useful: yesterday.' },
  { finishedAt: '2026-11-09T14:02:00.000Z', trigger: 'scheduled', status: 'failed', seconds: 120, usd: null, summary: 'Pi exited with code 1' },
]

test('the sky marks what ran today, what is still to come, and each window', () => {
  const routines = [
    routine({ id: 'recap', at: ['09:00', '18:00'] }),
    routine({ id: 'inbox', window: { start: '08:00', end: '16:00', everyMinutes: 120 } }),
    routine({ id: 'paused', at: '20:00', enabled: false }),
  ]
  const span = spanOf(NOW, TORONTO, 1)
  const marks = skyMarks({ span, now: NOW, routines, logs: { recap: LOG }, holds: {}, detail: true })

  const ran = marks.filter((mark) => mark.kind === 'ran')
  assert.equal(ran.length, 1, "yesterday's run is outside the day")
  assert.equal(ran[0]!.routineId, 'recap')
  assert.equal(ran[0]!.status, 'failed')
  close(ran[0]!.x, fractionAt(span, at('2026-11-09T14:00:00.000Z')), 'a run sits where it started')

  const due = marks.filter((mark) => mark.kind === 'due')
  assert.deepEqual(due.map((mark) => [mark.routineId, iso(mark.at)]), [
    ['inbox', '2026-11-09T21:00:00.000Z'],
    ['recap', '2026-11-09T23:00:00.000Z'],
  ])
  assert.equal(due.find((mark) => mark.routineId === 'recap')!.key, 'recap:2026-11-09:1', 'the same key as its line in the next seven days')

  const bands = marks.filter((mark) => mark.kind === 'band')
  assert.equal(bands.length, 1)
  close(bands[0]!.x, fractionAt(span, at('2026-11-09T08:00:00-05:00')))
  close(bands[0]!.end, fractionAt(span, at('2026-11-09T16:00:00-05:00')))
})

test('a run that has not finished yet is not a mark, and one that started before the span is left out', () => {
  const span = rollingSpan(NOW, TORONTO, 8, 16)
  const log: RunLine[] = [
    // The span starts at 12:00 UTC. This run started at 11:59 and finished inside it.
    { finishedAt: '2026-11-09T12:01:00.000Z', trigger: 'scheduled', status: 'completed', seconds: 120, usd: 0.1, summary: 'Started before the span.' },
    { finishedAt: '2026-11-09T16:00:30.000Z', trigger: 'manual', status: 'no_change', seconds: 30, usd: 0.02, summary: 'Nothing new.' },
  ]
  const marks = skyMarks({ span, now: NOW, routines: [routine({ id: 'recap' })], logs: { recap: log }, holds: {}, detail: true })
  const ran = marks.filter((mark) => mark.kind === 'ran')

  assert.deepEqual(ran.map((mark) => mark.summary), ['Nothing new.'])
  assert.equal(ran[0]!.kind === 'ran' && ran[0]!.manual, true)
})

test('in the week the sky marks only what is still to come', () => {
  const span = spanOf(NOW, TORONTO, 7)
  const marks = skyMarks({ span, now: NOW, routines: [routine({ id: 'recap' })], logs: { recap: LOG }, holds: {}, detail: false })

  assert.equal(marks.filter((mark) => mark.kind === 'due').length, 6, 'Tuesday to Sunday at 09:00')
  assert.equal(marks.filter((mark) => mark.kind === 'ran').length, 0)
  assert.ok(marks.every((mark) => mark.x >= 0 && mark.x <= 1))
})

test('in the week a window is one band a day, without a mark for each check', () => {
  const span = spanOf(NOW, TORONTO, 7)
  const inbox = routine({ id: 'inbox', cadence: 'weekly', weekday: [1, 2, 3, 4, 5], window: { start: '08:00', end: '17:00', everyMinutes: 60 } })
  const marks = skyMarks({ span, now: NOW, routines: [inbox], logs: {}, holds: {}, detail: false })

  assert.equal(marks.filter((mark) => mark.kind === 'due').length, 0)
  assert.deepEqual(
    marks.filter((mark) => mark.kind === 'band').map((mark) => mark.key),
    ['inbox:2026-11-09:window', 'inbox:2026-11-10:window', 'inbox:2026-11-11:window', 'inbox:2026-11-12:window', 'inbox:2026-11-13:window'],
    'Monday, still running at 15:00, to Friday',
  )
})

test('a held routine has no marks until its hold ends', () => {
  const span = spanOf(NOW, TORONTO, 7)
  const marks = skyMarks({ span, now: NOW, routines: [routine({ id: 'recap' })], logs: {}, holds: { recap: { until: '2026-11-12T00:00:00.000Z', reason: 'x' } }, detail: false })

  assert.equal(marks.filter((mark) => mark.kind === 'due').length, 4, 'Thursday to Sunday')
})
