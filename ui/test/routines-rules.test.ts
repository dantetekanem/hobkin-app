import assert from 'node:assert/strict'
import { test } from 'node:test'
import { byNextRun, changeTimes, factsOf, finishRun, holdFor, latestRuns, listOrder, RUNS_SHOWN, setEnabled, slideBetween, startRun, stateOf } from '../src/features/routines/rules.ts'
import type { Routine, RoutinesData, RunLine, RunStatus } from '../src/features/routines/types.ts'

const NOW = Date.parse('2026-11-09T22:40:00-05:00')
const DAY = 86_400_000

function routine(id: string, overrides: Partial<Routine> = {}): Routine {
  return {
    id,
    title: id,
    at: '09:00',
    timezone: 'America/Toronto',
    enabled: true,
    harness: 'pi',
    model: null,
    effort: 'medium',
    cwd: '/Users/sample/notes',
    context: [],
    cadence: 'daily',
    path: `/Users/sample/.hobkin/routines/daily/${id}.md`,
    prompt: 'Say what changed.',
    ...overrides,
  }
}

function line(daysAgo: number, status: RunStatus, summary: string = status): RunLine {
  return { finishedAt: new Date(NOW - daysAgo * DAY).toISOString(), trigger: 'scheduled', status, seconds: 40, usd: 0.1, summary }
}

function data(overrides: Partial<RoutinesData> = {}): RoutinesData {
  return {
    routines: [routine('recap'), routine('inbox', { at: undefined, window: { start: '08:00', end: '17:00', everyMinutes: 60 } })],
    errors: [],
    logs: { recap: [line(2, 'completed'), line(1, 'no_change')], inbox: [] },
    memory: {},
    reports: { recap: 'Useful: an older report.' },
    running: {},
    changedAt: {},
    templates: [],
    ...overrides,
  }
}

test('run now shows the routine as running at once, and the finished run joins its log', () => {
  const started = startRun(data(), 'recap', NOW)
  assert.deepEqual(started.running.recap, { startedAt: NOW, trigger: 'manual' })
  assert.equal(started.logs.recap!.length, 2, 'nothing is logged until the run finishes')

  const finished = finishRun(started, 'recap', NOW + 7_400, { status: 'completed', usd: 0.21, summary: 'Useful: 2 things changed.', report: 'Useful: 2 things changed.\n\nThe rest.' })
  assert.equal(finished.running.recap, undefined)
  assert.deepEqual(finished.logs.recap!.at(-1), {
    finishedAt: new Date(NOW + 7_400).toISOString(),
    trigger: 'manual',
    status: 'completed',
    seconds: 7,
    usd: 0.21,
    summary: 'Useful: 2 things changed.',
  })
  assert.equal(finished.reports.recap, 'Useful: 2 things changed.\n\nThe rest.')
})

test('a run that brings no report leaves the latest report as it was', () => {
  const finished = finishRun(startRun(data(), 'recap', NOW), 'recap', NOW + 3_000, { status: 'no_change', usd: 0.03, summary: 'Nothing new.' })

  assert.equal(finished.reports.recap, 'Useful: an older report.')
  assert.equal(finished.logs.recap!.at(-1)!.status, 'no_change')
})

test('a routine that is running is not started again, and an unknown one changes nothing', () => {
  const started = startRun(data(), 'recap', NOW)

  assert.equal(startRun(started, 'recap', NOW + 5_000), started)
  assert.equal(startRun(started, 'nobody', NOW), started)
  assert.equal(finishRun(started, 'inbox', NOW, { status: 'completed', usd: null, summary: 'x' }), started, 'nothing to finish')
})

test('turning a routine off and on changes that routine only', () => {
  const before = data()
  const off = setEnabled(before, 'recap', false)

  assert.equal(off.routines[0]!.enabled, false)
  assert.equal(off.routines[1], before.routines[1])
  assert.equal(setEnabled(off, 'recap', true).routines[0]!.enabled, true)
  assert.equal(setEnabled(before, 'recap', true), before, 'already on')
})

test('a new time replaces the old one, and a window and a time replace each other', () => {
  const retimed = changeTimes(data(), 'recap', { at: '11:15' }, NOW)
  assert.equal(retimed.routines[0]!.at, '11:15')
  assert.equal(retimed.changedAt.recap, NOW)

  const windowed = changeTimes(data(), 'recap', { window: { start: '09:00', end: '12:00', everyMinutes: 30 } }, NOW)
  assert.equal('at' in windowed.routines[0]!, false)
  assert.deepEqual(windowed.routines[0]!.window, { start: '09:00', end: '12:00', everyMinutes: 30 })

  const timed = changeTimes(data(), 'inbox', { at: ['09:00', '15:00'] }, NOW)
  assert.equal('window' in timed.routines[1]!, false)
  assert.deepEqual(timed.routines[1]!.at, ['09:00', '15:00'])
})

test('a routine is held by its log, and a run that works or a new time ends the hold', () => {
  const stuck = data({ logs: { recap: [line(3, 'completed'), line(2, 'failed'), line(0.5, 'failed', 'The notes folder is missing.')], inbox: [] } })

  assert.deepEqual(holdFor(stuck, 'recap', NOW), { until: new Date(NOW + 0.5 * DAY).toISOString(), reason: 'The notes folder is missing.' })
  assert.equal(holdFor(stuck, 'inbox', NOW), null)

  // A manual run ignores the hold. When it works, the streak is over.
  const ran = finishRun(startRun(stuck, 'recap', NOW), 'recap', NOW + 5_000, { status: 'completed', usd: 0.2, summary: 'Useful: back to normal.' })
  assert.equal(holdFor(ran, 'recap', NOW + 5_000), null)

  const retimed = changeTimes(stuck, 'recap', { at: '10:00' }, NOW)
  assert.equal(holdFor(retimed, 'recap', NOW + 1), null)
})

test('a routine shows as running first, then off, then held, then on', () => {
  const hold = { until: new Date(NOW + DAY).toISOString(), reason: 'x' }

  assert.equal(stateOf(routine('a'), false, null), 'on')
  assert.equal(stateOf(routine('a'), false, hold), 'held')
  assert.equal(stateOf(routine('a', { enabled: false }), false, hold), 'off')
  assert.equal(stateOf(routine('a', { enabled: false }), true, hold), 'running', 'a routine that is off can still be run by hand')
  assert.equal(stateOf(routine('a'), true, null), 'running')
})

test("each routine's facts: its state, its hold, and its next run, which for a held routine comes after the hold", () => {
  const stuck = data({
    routines: [routine('recap'), routine('night', { at: '23:30' }), routine('paused', { enabled: false })],
    logs: { recap: [line(2, 'failed'), line(0.5, 'failed', 'The notes folder is missing.')], night: [], paused: [] },
  })
  const [recap, night, paused] = factsOf(stuck, NOW)

  assert.equal(recap!.state, 'held')
  assert.equal(recap!.hold?.reason, 'The notes folder is missing.')
  // Held until tomorrow 10:40, so tomorrow's 09:00 is skipped.
  assert.equal(new Date(recap!.next!.at).toISOString(), '2026-11-11T14:00:00.000Z')
  assert.equal(night!.state, 'on')
  assert.equal(new Date(night!.next!.at).toISOString(), '2026-11-10T04:30:00.000Z')
  assert.equal(paused!.state, 'off')
  assert.equal(paused!.next, null)
  assert.equal(recap!.lastRun?.summary, 'The notes folder is missing.')
})

test('a group lists its routines by when they run next, with the ones that are off last', () => {
  const mixed = data({
    routines: [routine('paused', { enabled: false, title: 'A paused one' }), routine('late', { at: '23:50' }), routine('early', { at: '06:00' }), routine('night', { at: '23:30' })],
    logs: {},
  })

  assert.deepEqual(factsOf(mixed, NOW).toSorted(byNextRun).map((facts) => facts.routine.id), ['night', 'late', 'early', 'paused'])
})

test('an open routine lists the others as All routines does, and the detail slides in from the side the next one lies on', () => {
  const mixed = data({
    routines: [routine('weekly', { cadence: 'weekly', weekday: 1 }), routine('late', { at: '23:50' }), routine('early', { at: '06:00' })],
    logs: {},
  })
  const order = listOrder(factsOf(mixed, NOW))

  assert.deepEqual(order.map((facts) => facts.routine.id), ['late', 'early', 'weekly'])
  assert.equal(slideBetween(order, 'late', 'weekly'), 1, 'one further down comes in from the right')
  assert.equal(slideBetween(order, 'weekly', 'early'), -1, 'one further up comes in from the left')
  assert.equal(slideBetween(order, 'early', 'early'), 0, 'the same routine does not slide')
})

test('the detail shows the last 20 runs, newest first', () => {
  const many = Array.from({ length: 26 }, (_, index) => line(26 - index, 'completed', `run ${index + 1}`))
  const shown = latestRuns(many)

  assert.equal(RUNS_SHOWN, 20)
  assert.equal(shown.length, 20)
  assert.equal(shown[0]!.summary, 'run 26')
  assert.equal(shown.at(-1)!.summary, 'run 7')
  assert.deepEqual(latestRuns([]), [])
})
