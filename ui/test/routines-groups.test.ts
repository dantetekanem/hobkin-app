import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupExpanded } from '../src/features/routines/groups.ts'
import { factsOf } from '../src/features/routines/rules.ts'
import { prepareRoutines } from '../src/features/routines/prepare.ts'
import { buildSample } from '../src/features/routines/sample.ts'

const NOW = Date.parse('2026-11-10T14:04:00-05:00')
const ZONE = 'America/Toronto'
const data = buildSample(NOW, ZONE)
const base = data.routines[0]!
const weekly = { ...base, id: 'weekly', cadence: 'weekly' as const, weekday: 5, at: '09:00', window: undefined }
const monthly = { ...base, id: 'monthly', cadence: 'monthly' as const, day: 30, at: '09:00', window: undefined }
const fixture = { ...data, routines: [weekly, monthly], running: {}, logs: {} }

test('weekly and monthly groups follow actual occurrences in the rolling window', () => {
  const prepared = prepareRoutines(fixture, NOW, ZONE, 0)
  for (const facts of prepared.facts) assert.equal(groupExpanded([facts], prepared.day.marks), false)
  const dueData = { ...fixture, routines: [{ ...weekly, weekday: 2, at: '16:00' }, { ...monthly, day: 10, at: '16:00' }] }
  const due = prepareRoutines(dueData, NOW, ZONE, 0)
  for (const facts of due.facts) assert.equal(groupExpanded([facts], due.day.marks), true)
})

test('a due mark, recent run or running routine keeps its group visible', () => {
  const facts = factsOf(fixture, NOW)
  for (const kind of ['due', 'ran', 'band'] as const) {
    assert.equal(groupExpanded(facts, [{ routineId: 'weekly', kind }]), true)
  }
  assert.equal(groupExpanded([{ ...facts[0]!, state: 'running' }], []), true)
  assert.equal(groupExpanded(facts, [{ routineId: 'other', kind: 'due' }]), false)
})

test('explicit expansion survives refreshed facts and a changing view window', () => {
  const facts = factsOf(fixture, NOW)
  assert.equal(groupExpanded(facts, [], true), true)
  assert.equal(groupExpanded(factsOf(fixture, NOW + 60_000), [], true), true)
  assert.equal(groupExpanded(facts, [{ routineId: 'weekly', kind: 'due' }], false), false)
})
