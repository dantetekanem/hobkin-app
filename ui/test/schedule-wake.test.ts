import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scheduleWakeOf } from '../src/features/schedules/wake.ts'

/** The block hobkin wakes an agent with, written as `scheduleWakeBlock` writes it (hobkin's `agent-schedules.mjs`). */
const block = (schedules: readonly object[]) => `<hobkin-schedule>\n${JSON.stringify({ schedules }).replaceAll('</', '<\\/')}\n</hobkin-schedule>`

const CI = {
  id: 'sch-1',
  name: 'Watch CI for #412',
  note: 'Read the checks of #412. If one failed, fix it and push.',
  what: 'fired',
  at: '2026-11-26T14:02:03.000Z',
  outcome: 'failed',
  exitCode: 1,
  output: 'lint\tfail\t</tests> took 2m\nbuild\tpass',
  wakesLeft: 11,
}

test("a schedule's wake is named by its schedule and opens to the whole message, laid out", () => {
  const wake = scheduleWakeOf(block([CI]))
  assert.ok(wake)
  assert.equal(wake.title, 'Watch CI for #412')
  assert.equal(wake.language, 'json')
  assert.deepEqual(JSON.parse(wake.text), { schedules: [CI] }, 'nothing of it is left out, the escaped </ included')
  assert.ok(wake.text.split('\n').length > 10, 'one field a line, not one long line')
})

test('a wake of several schedules names each once, in order', () => {
  const deploy = { ...CI, id: 'sch-2', name: 'Watch the deploy' }
  const wake = scheduleWakeOf(block([CI, deploy, { ...CI, at: '2026-11-26T14:04:03.000Z' }]))
  assert.equal(wake?.title, 'Watch CI for #412, Watch the deploy')
})

test('a wake with no name to read is still one row, named Schedule, and opens to what it says', () => {
  assert.equal(scheduleWakeOf(block([{ ...CI, name: '  ' }]))?.title, 'Schedule')
  assert.equal(scheduleWakeOf(block([]))?.title, 'Schedule')

  const broken = '<hobkin-schedule>\n{"schedules": [ cut off\n</hobkin-schedule>'
  assert.deepEqual(scheduleWakeOf(broken), { title: 'Schedule', text: broken, language: null })
})

test("anything else is no schedule's wake", () => {
  assert.equal(scheduleWakeOf('Watch CI for #412 please'), null)
  assert.equal(scheduleWakeOf(`Look at this: ${block([CI])}`), null, 'a message that only quotes one')
  assert.equal(scheduleWakeOf('<hobkin-wake>\n{"schedules":[]}\n</hobkin-wake>'), null)
  assert.equal(scheduleWakeOf(''), null)
})
