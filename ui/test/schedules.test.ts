import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentSchedule } from '#shared/protocol/schedules.ts'
import {
  countdown,
  doesWords,
  endedWords,
  everyWords,
  lastRunWords,
  leftWords,
  orderSchedules,
  ownerWords,
  scheduleLine,
  schedulesGlow,
  schedulesIn,
  whenWords,
} from '../src/features/schedules/schedules.ts'
import { rollSample, sampleSchedules } from '../src/features/schedules/sample.ts'

const NOW = Date.parse('2026-11-23T15:00:00.000Z')
const at = (ms: number) => new Date(NOW + ms).toISOString()
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

const watch: AgentSchedule = {
  id: 's1',
  owner: { kind: 'run', id: 'run-412' },
  ownerTitle: 'Ship 412',
  name: 'Watch CI',
  does: 'shell',
  command: 'gh pr checks 412',
  note: 'Come back when the checks finish.',
  every: 120,
  state: 'waiting',
  nextAt: at(102 * SECOND),
  until: at(88 * MINUTE),
  runs: 7,
  maxRuns: 30,
  last: { at: at(-2 * MINUTE), outcome: 'pending', exitCode: 8, woke: false },
}

test('the countdown reads in seconds, then minutes, then hours, and has nothing to count once it is due', () => {
  assert.equal(countdown(42 * SECOND), '42s')
  assert.equal(countdown(400), '1s', 'a moment left still counts as a second, never 0s')
  assert.equal(countdown(MINUTE), '1:00')
  assert.equal(countdown(102 * SECOND), '1:42')
  assert.equal(countdown(HOUR - SECOND), '59:59')
  assert.equal(countdown(HOUR), '1:00:00')
  assert.equal(countdown(HOUR + 2 * MINUTE + 5 * SECOND), '1:02:05')
  assert.equal(countdown(0), null)
  assert.equal(countdown(-5 * SECOND), null)
})

test('when a schedule fires next, in words, for each way it can stand', () => {
  assert.equal(whenWords(watch, NOW), 'in 1:42')
  assert.equal(whenWords({ ...watch, nextAt: at(-3 * SECOND) }, NOW), 'due now', 'overdue')
  assert.equal(whenWords({ ...watch, state: 'running' }, NOW), 'running')
  assert.equal(whenWords({ ...watch, state: 'paused', nextAt: undefined }, NOW), 'paused')
  assert.equal(whenWords({ ...watch, state: 'done', nextAt: undefined }, NOW), 'done')
  assert.equal(whenWords({ ...watch, state: 'expired', nextAt: undefined }, NOW), 'expired')
  assert.equal(whenWords({ id: 'bare' }, NOW), 'waiting', 'a host that says nothing more')
})

test('the line says nothing with no schedule, the name and countdown of one, and the count and the next of many', () => {
  assert.equal(scheduleLine([], NOW), null)
  const one = scheduleLine([watch], NOW)
  assert.equal(one?.text, 'Watch CI in 1:42')
  assert.equal(one?.count, 1)
  assert.equal(one?.short, '1:42')
  const later: AgentSchedule = { ...watch, id: 's2', name: 'Check the deploy', nextAt: at(9 * MINUTE) }
  const many = scheduleLine([later, watch], NOW)
  assert.equal(many?.text, '2 · Watch CI in 1:42', 'the soonest is named, whatever order the host sent')
  assert.equal(many?.short, '2 · 1:42')
})

test('the line says a running schedule is running, and when every live one is paused, that they are', () => {
  const running: AgentSchedule = { ...watch, id: 's3', name: 'Deploy check', state: 'running' }
  assert.equal(scheduleLine([watch, running], NOW)?.text, '2 · Deploy check running')
  assert.equal(scheduleLine([watch, running], NOW)?.lead, 'running')
  const paused: AgentSchedule = { ...watch, state: 'paused', nextAt: undefined }
  assert.equal(scheduleLine([paused], NOW)?.text, 'Watch CI paused')
  assert.equal(scheduleLine([paused, { ...paused, id: 's4' }], NOW)?.text, '2 paused')
  assert.equal(scheduleLine([paused, { ...watch, id: 's5', name: 'Check the deploy' }], NOW)?.text, '2 · Check the deploy in 1:42', 'a waiting one leads a paused one')
  assert.equal(scheduleLine([{ ...watch, nextAt: at(-SECOND) }], NOW)?.text, 'Watch CI due now')
})

test('the line glows while a schedule runs or is due now, and is still while they wait, are paused or have ended', () => {
  assert.equal(schedulesGlow([watch, { ...watch, id: 's3', state: 'running' }], NOW), true)
  assert.equal(schedulesGlow([{ ...watch, nextAt: at(-SECOND) }], NOW), true, 'due now')

  assert.equal(schedulesGlow([watch], NOW), false, 'a countdown with time left')
  assert.equal(schedulesGlow([{ ...watch, state: 'paused', nextAt: undefined }], NOW), false)
  assert.equal(schedulesGlow([{ ...watch, state: 'done', nextAt: at(-SECOND) }, { ...watch, id: 's6', state: 'failed' }], NOW), false)
  assert.equal(schedulesGlow([], NOW), false)
})

test('with only ended schedules the line says they ended, and counts none as live', () => {
  const done: AgentSchedule = { ...watch, state: 'done', nextAt: undefined, endedWhy: 'the checks passed' }
  const ended = scheduleLine([done], NOW)
  assert.equal(ended?.text, 'Watch CI ended')
  assert.equal(ended?.lead, 'ended')
  assert.equal(ended?.count, 0)
  assert.equal(scheduleLine([done, { ...done, id: 's6', state: 'cancelled' }], NOW)?.text, '2 ended')
  assert.equal(scheduleLine([done, watch], NOW)?.text, 'Watch CI in 1:42', 'an ended one is not counted beside a live one')
})

test('a schedule with no name is named by its command or its note', () => {
  assert.equal(scheduleLine([{ ...watch, name: undefined }], NOW)?.text, 'gh pr checks 412 in 1:42')
  assert.equal(scheduleLine([{ id: 'w', does: 'wake', note: 'Look at the deploy', nextAt: at(30 * SECOND) }], NOW)?.text, 'Look at the deploy in 30s')
})

test('the main chat shows every schedule in the home, and a page shows only its own agent’s', () => {
  const main: AgentSchedule = { ...watch, id: 'm', owner: { kind: 'main' } }
  const hobkin: AgentSchedule = { ...watch, id: 'h', owner: { kind: 'hobkin', id: 'hb1' } }
  const other: AgentSchedule = { ...watch, id: 'o', owner: { kind: 'run', id: 'run-9' } }
  const all = [watch, main, hobkin, other]
  assert.deepEqual(schedulesIn(all, { kind: 'main' }).map(({ id }) => id), ['s1', 'm', 'h', 'o'])
  assert.deepEqual(schedulesIn(all, { kind: 'run', id: 'run-412' }).map(({ id }) => id), ['s1'])
  assert.deepEqual(schedulesIn(all, { kind: 'hobkin', id: 'hb1' }).map(({ id }) => id), ['h'])
  assert.deepEqual(schedulesIn(all, { kind: 'hobkin', id: 'run-412' }), [], 'a hobkin is not a run of the same id')
  assert.deepEqual(schedulesIn([{ id: 'nobody' }], { kind: 'run', id: 'run-412' }), [], 'one with no owner shows only in the main chat')
})

test('running ones come first, then the soonest, then paused ones, then those that ended, newest end first', () => {
  const list: AgentSchedule[] = [
    { id: 'ended-old', state: 'done', last: { at: at(-30 * MINUTE), outcome: 'passed' } },
    { id: 'later', state: 'waiting', nextAt: at(9 * MINUTE) },
    { id: 'paused', state: 'paused' },
    { id: 'ended-new', state: 'cancelled', last: { at: at(-MINUTE), outcome: 'failed' } },
    { id: 'soon', state: 'waiting', nextAt: at(20 * SECOND) },
    { id: 'running', state: 'running' },
    { id: 'unknown' },
  ]
  assert.deepEqual(orderSchedules(list).map(({ id }) => id), ['running', 'soon', 'later', 'unknown', 'paused', 'ended-new', 'ended-old'])
})

test('how often a schedule fires, in words', () => {
  assert.equal(everyWords(undefined), 'once')
  assert.equal(everyWords(60), 'every minute')
  assert.equal(everyWords(120), 'every 2 min')
  assert.equal(everyWords(90), 'every 1 min 30s')
  assert.equal(everyWords(3600), 'every hour')
})

test('what the last run found: how it ended, its exit code, how long ago and whether it woke the agent', () => {
  assert.deepEqual(lastRunWords(watch, NOW), { outcome: 'pending', tone: 'quiet', detail: 'exit 8 · 2 min ago · no wake' })
  assert.deepEqual(lastRunWords({ ...watch, last: { at: at(-40 * SECOND), outcome: 'failed', exitCode: 1, woke: true } }, NOW), {
    outcome: 'failed',
    tone: 'bad',
    detail: 'exit 1 · 40s ago · woke it',
  })
  assert.deepEqual(lastRunWords({ ...watch, last: { at: at(-3 * SECOND), outcome: 'passed', exitCode: 0, woke: true } }, NOW), {
    outcome: 'passed',
    tone: 'ok',
    detail: 'exit 0 · just now · woke it',
  })
  assert.deepEqual(lastRunWords({ ...watch, last: { at: at(-3 * HOUR), outcome: 'timed-out' } }, NOW), { outcome: 'timed out', tone: 'bad', detail: '3 h ago · no wake' })
  assert.deepEqual(lastRunWords({ ...watch, last: { at: at(-MINUTE), outcome: 'error' } }, NOW), { outcome: 'could not start', tone: 'bad', detail: '1 min ago' })
  assert.deepEqual(lastRunWords({ ...watch, last: undefined }, NOW), { outcome: 'not run yet', tone: 'quiet', detail: '' })
  assert.deepEqual(lastRunWords({ id: 'w', does: 'wake', note: 'Look again', last: { at: at(-5 * MINUTE), outcome: 'passed', woke: true } }, NOW), {
    outcome: 'woke it',
    tone: 'quiet',
    detail: '5 min ago',
  })
})

test('a run that did not end by itself says what the runtime said of it, and "could not start" only when it said nothing', () => {
  const cutOff = lastRunWords({ ...watch, last: { at: at(-2 * MINUTE), outcome: 'error', line: 'It was cut off before it finished.' } }, NOW)

  assert.deepEqual(cutOff, { outcome: 'it was cut off before it finished', tone: 'bad', detail: '2 min ago' })
})

test('an ended schedule gives the runtime’s reason as it is', () => {
  const ended: AgentSchedule = { ...watch, state: 'done', endedWhy: 'it woke its agent 12 times, the most one schedule may' }

  assert.equal(endedWords(ended), 'it woke its agent 12 times, the most one schedule may')
})

test('what a schedule has left: its runs and the time to its end', () => {
  assert.equal(leftWords(watch, NOW), '23 runs and 1 h 28 min left')
  assert.equal(leftWords({ ...watch, runs: 29 }, NOW), '1 run and 1 h 28 min left')
  assert.equal(leftWords({ ...watch, maxRuns: undefined }, NOW), '1 h 28 min left')
  assert.equal(leftWords({ ...watch, until: at(2 * HOUR) }, NOW), '23 runs and 2 h left')
  assert.equal(leftWords({ ...watch, until: at(40 * SECOND), maxRuns: undefined }, NOW), '40s left')
  assert.equal(leftWords({ ...watch, until: undefined }, NOW), '23 runs left, no end', 'no end time is no end')
  assert.equal(leftWords({ ...watch, until: at(-SECOND) }, NOW), 'ends now')
  assert.equal(leftWords({ id: 'bare' }, NOW), 'no end')
  assert.equal(leftWords({ ...watch, state: 'done' }, NOW), null, 'an ended one has nothing left')
})

test('what a schedule does and whose it is', () => {
  assert.deepEqual(doesWords(watch), { kind: 'command', text: 'gh pr checks 412' })
  assert.deepEqual(doesWords({ ...watch, command: 'cd web\n  gh pr checks 412\n' }), { kind: 'command', text: 'cd web ↵ gh pr checks 412' })
  assert.deepEqual(doesWords({ id: 'w', does: 'wake', note: 'Look at the deploy' }), { kind: 'wake', text: 'Look at the deploy' })
  assert.equal(ownerWords(watch), 'Ship 412')
  assert.equal(ownerWords({ id: 'm', owner: { kind: 'main' } }), 'hobkin')
  assert.equal(ownerWords({ id: 'h', owner: { kind: 'hobkin', id: 'hb1' } }), 'a durable hobkin')
  assert.equal(ownerWords({ id: 'x' }), 'an agent')
})

test('the sample schedules keep counting down: a repeating one that came due moves on to its next time', () => {
  const sample = sampleSchedules(NOW)
  assert.ok(sample.some(({ owner }) => owner?.kind === 'main'), 'the main chat has its own')
  assert.ok(sample.some(({ owner }) => owner?.kind === 'run'), 'an agent has its own')
  assert.ok(sample.some(({ owner }) => owner?.kind === 'hobkin'), 'a durable hobkin has its own')
  const later = NOW + 10 * MINUTE
  for (const schedule of rollSample(sample, later)) {
    if (schedule.state === 'waiting' && schedule.every) assert.ok(Date.parse(schedule.nextAt!) > later, `${schedule.id} is not overdue`)
  }
  assert.equal(rollSample(sample, NOW), sample, 'nothing came due, so nothing changes')
})
