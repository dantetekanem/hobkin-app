import assert from 'node:assert/strict'
import { test } from 'node:test'
import { routinesFromHost } from '../src/features/routines/host-data.ts'
import { commandWords, isWorkflowRow, pressable, startWords, workflowRowsOf } from '../src/integration/workflows.ts'

const digest = { id: 'echo/digest', integration: 'echo', title: 'Morning digest', on: ['press', 'after:echo.say-twice'], cadence: null, enabled: true, nextRun: { state: 'unscheduled', at: null } }
const nightly = { id: 'echo/nightly', integration: 'echo', on: ['start'], cadence: 'daily', enabled: false, nextRun: { state: 'paused', at: null }, lastRun: { at: '2026-11-24T08:00:00Z', outcome: 'completed' } }
const routine = { id: 'recap', title: 'Recap', timezone: 'UTC', enabled: true, harness: 'pi', model: null, effort: 'low', cwd: '/x', context: [], at: '08:00', cadence: 'daily', path: '/r.md', prompt: 'p' }

test('a workflow row is read with what starts it, and a routine row is not a workflow', () => {
  const rows = workflowRowsOf([routine, digest, nightly, { id: 'x', integration: 'echo' }], undefined)
  assert.deepEqual(rows.map(({ id }) => id), ['echo/digest', 'echo/nightly'])
  assert.deepEqual(rows[0]!.starts, [{ kind: 'press' }, { kind: 'after', command: 'echo.say-twice' }])
  assert.equal(rows[0]!.state, 'unscheduled')
  assert.equal(rows[1]!.title, 'nightly', 'a row with no title is named by its file')
  assert.deepEqual(rows[1]!.lastRun, { at: '2026-11-24T08:00:00Z', outcome: 'completed' })
  assert.deepEqual(workflowRowsOf([digest, { ...digest, id: 'other/a', integration: 'other' }], 'other').map(({ id }) => id), ['other/a'])
  assert.equal(isWorkflowRow(routine), false)
})

test('what starts a workflow reads in plain words, with the integration beside it', () => {
  const [one, two] = workflowRowsOf([digest, nightly])
  assert.equal(startWords(one!, 'Echo'), 'On a press · After say twice')
  assert.equal(startWords(two!, 'Echo'), 'Every day · When Echo starts it')
  assert.equal(commandWords('github.issue.close', 'github'), 'issue close')
  assert.equal(startWords({ starts: [], cadence: null, integration: 'echo' }, 'Echo'), 'Nothing starts it')
})

test('only a workflow turned on that a press starts can be run now', () => {
  const [one, two] = workflowRowsOf([digest, nightly])
  assert.equal(pressable(one!), true)
  assert.equal(pressable({ ...one!, enabled: false }), false)
  assert.equal(pressable(two!), false)
})

test('the Routines data leaves workflow rows to their own group and does not call them broken', () => {
  const data = routinesFromHost({ schedules: [routine, digest, nightly] } as never)
  assert.deepEqual(data.routines.map(({ id }) => id), ['recap'])
  assert.deepEqual(data.errors, [])
})
