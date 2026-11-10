import assert from 'node:assert/strict'
import { test } from 'node:test'
import { holdFor, stateOf } from '../src/features/routines/rules.ts'
import { buildSample } from '../src/features/routines/sample.ts'
import { nextRun } from '../src/features/routines/timeline.ts'
import { RECURRENCES, type RoutinesData, type RoutineState } from '../src/features/routines/types.ts'

const TORONTO = 'America/Toronto'
/** The sample is built from the clock, so it has to hold at any hour, on any day, in any season. */
const CLOCKS = ['2026-11-09T22:40:00-05:00', '2026-11-10T03:10:00-05:00', '2026-11-14T12:00:00-05:00', '2026-03-08T09:30:00-04:00', '2026-12-31T23:59:00-05:00', '2027-02-28T07:44:00-05:00']

function states(sample: RoutinesData, now: number): Record<RoutineState, string[]> {
  const found: Record<RoutineState, string[]> = { on: [], off: [], held: [], running: [] }
  for (const routine of sample.routines) found[stateOf(routine, routine.id in sample.running, holdFor(sample, routine.id, now))].push(routine.id)
  return found
}

for (const clock of CLOCKS) {
  const now = Date.parse(clock)
  const sample = buildSample(now, TORONTO)

  test(`the sample has every kind of routine the screen must show, at ${clock}`, () => {
    assert.ok(sample.routines.length >= 9, `${sample.routines.length} routines`)
    for (const recurrence of RECURRENCES) assert.ok(sample.routines.some((routine) => routine.cadence === recurrence), recurrence)
    assert.equal(new Set(sample.routines.map((routine) => routine.id)).size, sample.routines.length, 'ids are unique')
    assert.ok(sample.routines.some((routine) => routine.window), 'one with a window')
    assert.ok(sample.routines.some((routine) => Array.isArray(routine.at)), 'one with several times')
    assert.ok(sample.routines.some((routine) => routine.timezone !== TORONTO), 'one in another timezone')
    assert.ok(sample.errors.length >= 1, 'one definition error')
    assert.ok(sample.templates.length >= 3)

    const found = states(sample, now)
    assert.equal(found.off.length, 1, `off: ${found.off}`)
    assert.equal(found.held.length, 1, `held: ${found.held}`)
    assert.equal(found.running.length, 1, `running: ${found.running}`)
    assert.ok(found.on.length >= 6)
  })

  test(`every sample routine has a log, a memory and a schedule that makes sense, at ${clock}`, () => {
    for (const routine of sample.routines) {
      const log = sample.logs[routine.id] ?? []
      assert.ok(log.length >= 6 && log.length <= 20, `${routine.id} has ${log.length} log lines`)
      const times = log.map((line) => Date.parse(line.finishedAt))
      assert.deepEqual(times, [...times].sort((a, b) => a - b), `${routine.id}: oldest first`)
      assert.ok(times.every((time) => time < now), `${routine.id}: every run has finished`)
      assert.ok((sample.memory[routine.id] ?? '').trim().length > 40, `${routine.id} has a memory`)
      assert.ok(routine.prompt.trim().length > 40, `${routine.id} has a prompt`)
      assert.ok(routine.path.endsWith(`/routines/${routine.cadence}/${routine.id}.md`), routine.path)
      assert.equal(Boolean(routine.at) !== Boolean(routine.window), true, `${routine.id} has a time or a window`)
    }

    const held = sample.routines.find((routine) => holdFor(sample, routine.id, now) && routine.enabled && !(routine.id in sample.running))!
    const hold = holdFor(sample, held.id, now)!
    assert.ok(Date.parse(hold.until) > now + 3_600_000, 'the hold still has a while to go')
    assert.ok(hold.reason.length > 10)

    const once = sample.routines.find((routine) => routine.cadence === 'once')!
    assert.ok(nextRun(once, now), 'the once routine is still to come')

    const running = sample.routines.find((routine) => routine.id in sample.running)!
    assert.ok(sample.running[running.id]!.startedAt < now)
  })
}

test('the sample follows the timezone it is given', () => {
  const sample = buildSample(Date.parse(CLOCKS[0]!), 'Asia/Tokyo')
  assert.ok(sample.routines.filter((routine) => routine.timezone === 'Asia/Tokyo').length >= 6)
})
