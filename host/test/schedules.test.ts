import assert from 'node:assert/strict'
import { test } from 'node:test'
import { COMMANDS } from '#shared/commands/registry.ts'
import type { AgentSchedule } from '#shared/protocol/schedules.ts'
import { createClientTool } from '../src/client-tool.ts'
import { runCommand, Unavailable } from '../src/commands.ts'
import { AgentScheduleReader, scheduleHandlers, scheduleOperationsOf, type ScheduleOperations } from '../src/schedules.ts'

const WATCH: AgentSchedule = { id: 'sch-1', owner: { kind: 'run', id: 'session:ship' }, name: 'Watch CI for #412', does: 'shell', command: 'gh pr checks 412', state: 'waiting', every: 120 }
const NAP: AgentSchedule = { id: 'sch-2', owner: { kind: 'main' }, does: 'wake', note: 'Look at the deploy.', state: 'paused' }
const DONE: AgentSchedule = { id: 'sch-3', owner: { kind: 'hobkin', id: 'a1b2c3d4' }, name: 'Wait for the build', state: 'done', endedWhy: 'the checks passed' }
const QUIET: AgentSchedule = { id: 'sch-4', state: 'expired' }
const NAMES = ['schedule.cancel', 'schedule.pause', 'schedule.run'] as const

/** The runtime's three operations, recording each call and answering as `answer` says. */
function fakeRuntime(answer: () => unknown = () => ({ ok: true })) {
  const calls: unknown[][] = []
  const called = (...call: unknown[]) => {
    calls.push(call)
    return answer()
  }
  const operations: ScheduleOperations = {
    cancel: async (id) => called('cancel', id),
    pause: async (id, paused) => called('pause', id, paused),
    run: async (id) => called('run', id),
  }
  return { calls, operations }
}

const refused = (message: string | RegExp) => (outcome: unknown) => {
  const { ok, error } = outcome as { ok: boolean; error?: { code: string; message: string } }
  return !ok && error?.code === 'unavailable' && (typeof message === 'string' ? error.message === message : message.test(error.message))
}

test("each command reaches the runtime for a live schedule and answers with what it said", async () => {
  const { calls, operations } = fakeRuntime()
  const handlers = scheduleHandlers({ operations: () => operations, schedules: () => [WATCH, NAP] })

  assert.deepEqual(await runCommand(handlers, 'schedule.cancel', { id: 'sch-1' }), { ok: true, value: { ok: true } })
  assert.deepEqual(await runCommand(handlers, 'schedule.pause', { id: 'sch-1', paused: true }), { ok: true, value: { ok: true } })
  assert.deepEqual(await runCommand(handlers, 'schedule.pause', { id: 'sch-2', paused: false }), { ok: true, value: { ok: true } })
  assert.deepEqual(await runCommand(handlers, 'schedule.run', { id: 'sch-2' }), { ok: true, value: { ok: true } })
  assert.deepEqual(calls, [['cancel', 'sch-1'], ['pause', 'sch-1', true], ['pause', 'sch-2', false], ['run', 'sch-2']])
})

test("the runtime's refusal comes back in its own words, and an answer it does not know is a refusal too", async () => {
  const words = fakeRuntime(() => ({ ok: false, reason: 'It is running its command now, so it cannot run twice at once.' }))
  const handlers = scheduleHandlers({ operations: () => words.operations, schedules: () => [WATCH] })
  assert.ok(refused('It is running its command now, so it cannot run twice at once.')(await runCommand(handlers, 'schedule.run', { id: 'sch-1' })))

  for (const answer of [undefined, null, 'ok', { ok: 'yes' }, { ok: false }, { ok: false, reason: '' }]) {
    const odd = fakeRuntime(() => answer)
    const said = await runCommand(scheduleHandlers({ operations: () => odd.operations, schedules: () => [WATCH] }), 'schedule.cancel', { id: 'sch-1' })
    assert.ok(refused('hobkin did not say it was done, so the schedule may be as it was.')(said), JSON.stringify(answer))
  }

  const long = fakeRuntime(() => ({ ok: false, reason: 'x'.repeat(2000) }))
  const cut = await runCommand(scheduleHandlers({ operations: () => long.operations, schedules: () => [WATCH] }), 'schedule.cancel', { id: 'sch-1' })
  assert.equal((cut as { error: { message: string } }).error.message.length, 300)
})

test('an unknown or ended schedule is refused in plain words, and the runtime is never asked', async () => {
  const { calls, operations } = fakeRuntime()
  const handlers = scheduleHandlers({ operations: () => operations, schedules: () => [WATCH, DONE, QUIET] })

  const unknown = 'hobkin has no such schedule, so nothing changed.'
  for (const [name, args] of [['schedule.cancel', { id: 'sch-9' }], ['schedule.pause', { id: 'sch-9', paused: true }], ['schedule.run', { id: 'sch-9' }]] as const) {
    assert.ok(refused(unknown)(await runCommand(handlers, name, args)), name)
  }
  assert.ok(refused('"Wait for the build" has already ended (the checks passed), so there is nothing to cancel.')(await runCommand(handlers, 'schedule.cancel', { id: 'sch-3' })))
  assert.ok(refused('"Wait for the build" has already ended (the checks passed), so it cannot be paused.')(await runCommand(handlers, 'schedule.pause', { id: 'sch-3', paused: true })))
  assert.ok(refused('That schedule has already ended, so it cannot go on.')(await runCommand(handlers, 'schedule.pause', { id: 'sch-4', paused: false })))
  assert.ok(refused('That schedule has already ended, so it cannot run now.')(await runCommand(handlers, 'schedule.run', { id: 'sch-4' })))

  // A runtime that sends no list has no schedule to act on.
  const none = scheduleHandlers({ operations: () => operations, schedules: () => undefined })
  assert.ok(refused(unknown)(await runCommand(none, 'schedule.run', { id: 'sch-1' })))
  assert.deepEqual(calls, [])
})

test('a runtime without schedules, or one that throws for them, answers that schedules are not available', async () => {
  const notAvailable = 'Schedules are not available in this hobkin yet. Restart the app to load them.'
  const broken = () => {
    throw Error('agentSchedules is not a function')
  }
  for (const operations of [() => null, () => undefined, broken]) {
    const handlers = scheduleHandlers({ operations, schedules: () => [WATCH] })
    for (const [name, args] of [['schedule.cancel', { id: 'sch-1' }], ['schedule.pause', { id: 'sch-1', paused: true }], ['schedule.run', { id: 'sch-1' }]] as const) {
      assert.ok(refused(notAvailable)(await runCommand(handlers, name, args)), name)
    }
  }

  // hobkin not open yet says so, as every other command does.
  const starting = scheduleHandlers({
    operations: () => {
      throw new Unavailable('hobkin is still starting.')
    },
    schedules: () => [WATCH],
  })
  assert.ok(refused('hobkin is still starting.')(await runCommand(starting, 'schedule.cancel', { id: 'sch-1' })))
})

test("only the window sends them: hobkin's own client tool neither lists nor runs them", async () => {
  const { calls, operations } = fakeRuntime()
  const handlers = scheduleHandlers({ operations: () => operations, schedules: () => [WATCH] })
  const tool = createClientTool({ run: (name, args) => runCommand(handlers, name, args) })

  const listed = (await tool.execute('1', { action: 'list' })).details as { name: string }[]
  for (const name of NAMES) {
    assert.equal(COMMANDS[name].runs, 'host')
    assert.equal('hobkin' in COMMANDS[name], false, name)
    assert.equal(listed.some((command) => command.name === name), false, name)
  }
  await assert.rejects(tool.execute('2', { action: 'run', name: 'schedule.cancel', args: { id: 'sch-1' } }), /needs the user's yes in the window/)
  await assert.rejects(tool.execute('3', { action: 'run', name: 'schedule.pause', args: { id: 'sch-1', paused: true } }), /needs the user's yes in the window/)
  await assert.rejects(tool.execute('4', { action: 'run', name: 'schedule.run', args: { id: 'sch-1' } }), /needs the user's yes in the window/)
  assert.deepEqual(calls, [])
})

test('the arguments are checked before any handler: an id the runtime could not have made, and a pause with no answer, are refused', async () => {
  const { calls, operations } = fakeRuntime()
  const handlers = scheduleHandlers({ operations: () => operations, schedules: () => [WATCH] })
  for (const [name, args] of [
    ['schedule.cancel', {}],
    ['schedule.cancel', { id: '' }],
    ['schedule.cancel', { id: '../x' }],
    ['schedule.run', { id: 'x'.repeat(129) }],
    ['schedule.pause', { id: 'sch-1' }],
    ['schedule.pause', { id: 'sch-1', paused: 'yes' }],
    ['schedule.run', { id: 'sch-1', now: true }],
  ] as const) {
    const said = await runCommand(handlers, name, args)
    assert.equal(!said.ok && said.error.code, 'invalid-arguments', JSON.stringify([name, args]))
  }
  assert.deepEqual(calls, [])
})

/** hobkin's application as far as schedules go, with the runtime's own method names, answering as the runtime does. */
class FakeApplication {
  readonly calls: unknown[][] = []
  private readonly live: readonly string[]

  constructor(live: readonly string[]) {
    this.live = live
  }

  private answer(id: string) {
    return this.live.includes(id) ? { ok: true } : { ok: false, reason: 'There is no schedule with that id.' }
  }

  async cancelAgentSchedule(id: string) {
    this.calls.push(['cancel', id])
    return this.answer(id)
  }

  async pauseAgentSchedule(id: string, paused: boolean) {
    this.calls.push(['pause', id, paused])
    return this.answer(id)
  }

  async runAgentSchedule(id: string) {
    this.calls.push(['run', id])
    return this.answer(id)
  }
}

test("the handlers reach a running application's own schedule methods, and the runtime's refusal passes on", async () => {
  const app = new FakeApplication(['sch-1'])
  // The window's list still has sch-2, which the runtime has dropped since.
  const handlers = scheduleHandlers({ operations: () => scheduleOperationsOf(app), schedules: () => [WATCH, NAP] })

  assert.deepEqual(await runCommand(handlers, 'schedule.pause', { id: 'sch-1', paused: true }), { ok: true, value: { ok: true } })
  assert.deepEqual(await runCommand(handlers, 'schedule.run', { id: 'sch-1' }), { ok: true, value: { ok: true } })
  assert.deepEqual(await runCommand(handlers, 'schedule.cancel', { id: 'sch-1' }), { ok: true, value: { ok: true } })
  assert.ok(refused('There is no schedule with that id.')(await runCommand(handlers, 'schedule.cancel', { id: 'sch-2' })))
  assert.deepEqual(app.calls, [['pause', 'sch-1', true], ['run', 'sch-1'], ['cancel', 'sch-1'], ['cancel', 'sch-2']])
})

test('an application from before schedules, or with only some of the methods, has no schedules to act on', async () => {
  const partial = { cancelAgentSchedule: async () => ({ ok: true }), pauseAgentSchedule: 'not a method' }
  for (const app of [{}, { kill: async () => true }, partial]) {
    assert.equal(scheduleOperationsOf(app), null)
    const handlers = scheduleHandlers({ operations: () => scheduleOperationsOf(app), schedules: () => [WATCH] })
    assert.ok(refused('Schedules are not available in this hobkin yet. Restart the app to load them.')(await runCommand(handlers, 'schedule.cancel', { id: 'sch-1' })))
  }
})

const RUNS = [{ id: 'session:ship', title: 'Ship 412', state: 'waiting' }]
const HOBKINS = [{ id: 'a1b2c3d4', title: 'Tests' }]

test("the snapshot's schedules are read without trust and name their owners: hobkin, a durable hobkin's name, a run's title", () => {
  const reader = new AgentScheduleReader()
  const given = { ...DONE, ownerTitle: 'The runtime says' }
  const snapshot = { busy: false, runs: RUNS, hobkins: HOBKINS, agentSchedules: [WATCH, NAP, DONE, given, { id: 'odd', state: 'sleeping' }, { ...QUIET, owner: { kind: 'run', id: 'gone' } }] }
  const wired = reader.wire(snapshot)

  assert.deepEqual(wired.agentSchedules, [
    { ...WATCH, ownerTitle: 'Ship 412' },
    { ...NAP, ownerTitle: 'hobkin' },
    { ...DONE, ownerTitle: 'Tests' },
    { ...QUIET, owner: { kind: 'run', id: 'gone' } },
  ], 'the second row with the id sch-3 is dropped, and an owner hobkin no longer lists goes untitled')
  assert.equal(wired.busy, false)
  assert.equal(wired.runs, RUNS, 'the rest of the snapshot is passed as it came')
  assert.deepEqual(reader.read(snapshot), wired.agentSchedules)

  // The runtime's own title stands where it gives one.
  assert.deepEqual(reader.wire({ agentSchedules: [given] }).agentSchedules, [given])
})

test('the same schedules, runs and hobkins give the same list, so the window is not sent it again', () => {
  const reader = new AgentScheduleReader()
  const agentSchedules = [WATCH, NAP]
  const first = reader.wire({ runs: RUNS, hobkins: HOBKINS, agentSchedules }).agentSchedules
  assert.equal(reader.wire({ runs: RUNS, hobkins: HOBKINS, agentSchedules, busy: true }).agentSchedules, first)
  assert.notEqual(reader.wire({ runs: [{ ...RUNS[0], title: 'Ship 413' }], hobkins: HOBKINS, agentSchedules }).agentSchedules, first)
})

test('a snapshot from a runtime with no schedules passes as it came, and one whose list cannot be read goes without it', () => {
  const reader = new AgentScheduleReader()
  const older = { busy: true, runs: RUNS }
  assert.equal(reader.wire(older), older, 'the very same snapshot')
  assert.equal(reader.read(older), undefined)
  assert.equal(reader.read(null), undefined)

  for (const odd of [null, 'busy', { 'sch-1': WATCH }]) {
    const wired = reader.wire({ busy: true, agentSchedules: odd })
    assert.deepEqual(wired, { busy: true }, JSON.stringify(odd))
  }

  const throwing = { busy: true }
  Object.defineProperty(throwing, 'agentSchedules', { enumerable: true, get: () => assert.fail('a getter the runtime broke') })
  assert.deepEqual(reader.wire(throwing), { busy: true })
  assert.equal(reader.read(throwing), undefined)
})
