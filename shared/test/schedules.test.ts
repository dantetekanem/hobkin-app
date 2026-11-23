import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AGENT_SCHEDULES_MAX, readAgentSchedules, type AgentSchedule } from '#shared/protocol/schedules.ts'

const WATCH: AgentSchedule = {
  id: 'sch-1',
  owner: { kind: 'run', id: 'session:ship-412' },
  name: 'Watch CI for #412',
  does: 'shell',
  command: 'gh pr checks 412',
  note: 'Read the failing check and fix it.',
  every: 120,
  state: 'waiting',
  nextAt: '2026-11-23T16:02:00.000Z',
  until: '2026-11-23T18:00:00.000Z',
  runs: 7,
  maxRuns: 30,
  wakes: 0,
  maxWakes: 12,
  last: { at: '2026-11-23T16:00:00.000Z', outcome: 'pending', exitCode: 8, woke: false, line: 'build pending' },
}

test('a schedule in the shape of the contract reads as it came', () => {
  const ended: AgentSchedule = { id: 'sch-2', owner: { kind: 'main' }, ownerTitle: 'hobkin', does: 'wake', note: 'Look again.', state: 'done', endedWhy: 'it fired once' }
  assert.deepEqual(readAgentSchedules([WATCH, ended]), [WATCH, ended])
})

test('a runtime that has none reads as none, and an empty list as an empty one', () => {
  for (const none of [undefined, null, 'busy', 3, { 'sch-1': WATCH }]) assert.equal(readAgentSchedules(none), undefined, JSON.stringify(none))
  assert.deepEqual(readAgentSchedules([]), [])
})

test('a row with no id, an id too long, or a state the window does not know is dropped, and so is a second row with the same id', () => {
  const rows = [
    null,
    'sch-9',
    { state: 'waiting' },
    { id: '', state: 'waiting' },
    { id: 'x'.repeat(129), state: 'waiting' },
    { id: 'sch-3', state: 'sleeping' },
    { id: 'sch-4' },
    WATCH,
    { ...WATCH, name: 'A second copy' },
  ]
  assert.deepEqual(readAgentSchedules(rows), [WATCH])
})

test('a field of the wrong kind is left out, and the row keeps the rest', () => {
  const [read] = readAgentSchedules([
    {
      id: 'sch-5',
      state: 'paused',
      owner: { kind: 'teams', id: 'a' },
      does: 'cron',
      every: -5,
      runs: 1.5,
      maxRuns: '30',
      wakes: Number.NaN,
      maxWakes: Infinity,
      nextAt: 'tomorrow',
      until: 1764000000000,
      name: 42,
      last: { at: '2026-11-23T16:00:00.000Z', outcome: 'skipped' },
      extra: 'not in the contract',
    },
  ])!
  assert.deepEqual(read, { id: 'sch-5', state: 'paused' })

  const [owned] = readAgentSchedules([{ id: 'sch-6', state: 'running', owner: { kind: 'hobkin', id: 7 }, last: { at: 'soon', outcome: 'passed' } }])!
  assert.deepEqual(owned, { id: 'sch-6', state: 'running', owner: { kind: 'hobkin' } }, 'an owner keeps its kind without an id it cannot read; a run with no time is left out')

  const [run] = readAgentSchedules([{ id: 'sch-7', state: 'done', last: { at: '2026-11-23T16:00:00.000Z', outcome: 'failed', exitCode: 1.5, woke: 'yes', line: 3 } }])!
  assert.deepEqual(run, { id: 'sch-7', state: 'done', last: { at: '2026-11-23T16:00:00.000Z', outcome: 'failed' } })
})

test('words are cut to the lengths the tools allow, and a cut never splits a character in two', () => {
  const [read] = readAgentSchedules([
    {
      id: 'sch-8',
      state: 'waiting',
      name: 'n'.repeat(200),
      command: 'c'.repeat(5000),
      note: 'w'.repeat(1500),
      ownerTitle: 't'.repeat(300),
      endedWhy: 'e'.repeat(300),
      owner: { kind: 'run', id: 'r'.repeat(300) },
      last: { at: '2026-11-23T16:00:00.000Z', outcome: 'passed', line: `${'l'.repeat(199)}😀 and more` },
    },
  ])!
  assert.equal(read.name!.length, 80)
  assert.equal(read.command!.length, 4000)
  assert.equal(read.note!.length, 1000)
  assert.equal(read.ownerTitle!.length, 120)
  assert.equal(read.endedWhy!.length, 200)
  assert.deepEqual(read.owner, { kind: 'run' }, 'an id is never cut, since a cut one names another owner')
  assert.equal(read.last!.line, 'l'.repeat(199), 'the emoji that would be cut in half goes whole')
})

test('a list longer than the window draws keeps its first rows', () => {
  const rows = Array.from({ length: AGENT_SCHEDULES_MAX + 5 }, (_, index) => ({ id: `sch-${index}`, state: 'done' }))
  const read = readAgentSchedules(rows)!
  assert.equal(read.length, AGENT_SCHEDULES_MAX)
  assert.equal(read.at(-1)!.id, `sch-${AGENT_SCHEDULES_MAX - 1}`)
})
