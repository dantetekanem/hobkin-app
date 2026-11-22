import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runWorkCommand } from 'hobkin/src/cli/work/commands.mjs'
import { workloadOf } from 'hobkin/src/cli/work/store.mjs'
import { checkArguments, COMMANDS } from '#shared/commands/registry.ts'
import { runCommand } from '../src/commands.ts'
import { workFrom, workHandlers, type WorkApp } from '../src/work.ts'
import { temporaryDirectory } from './support.ts'

/*
 * The user's workload (053-work-control-room): set from the window through `work.workload`, kept by hobkin in its own
 * mode file, and published on the work state with what holds work mode, the outlook and hobkin's open allowance request.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** Stands in for hobkin's application: its work actions are hobkin's own commands on the test's home. */
function fakeHobkin(root: string) {
  const calls: unknown[][] = []
  const app: WorkApp = {
    workAction: async (...args: unknown[]) => {
      calls.push(args)
      if (args[0] === 'allow') return runWorkCommand(root, ['allow'])
      return { ok: true }
    },
    refresh: async () => {
      calls.push(['refresh'])
    },
  }
  return { app, calls }
}

const handlersOf = (root: string) => {
  const { app, calls } = fakeHobkin(root)
  return { handlers: workHandlers({ app: () => app, root: () => root }), calls }
}
const stateOf = async (root: string) => workFrom({ work: await runWorkCommand(root, []), waiting: null })!
const pad = (value: number) => String(value).padStart(2, '0')
/** The local clock `hours` from now, as HH:MM. */
const clockIn = (hours: number) => {
  const at = new Date(Date.now() + hours * HOUR)
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`
}
/** The next time the local clock reads `clock`. */
function nextTime(clock: string): string {
  const at = new Date()
  at.setHours(Number(clock.slice(0, 2)), Number(clock.slice(3)), 0, 0)
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1)
  return at.toISOString()
}
const modeFile = (root: string) => join(root, 'work', 'mode.json')

test('the workload is set from the window, answered as it stands, and kept in hobkin\'s own file, so a new host reads it again', async (t) => {
  const root = temporaryDirectory(t)
  const { handlers, calls } = handlersOf(root)

  assert.deepEqual((await stateOf(root)).workload, {
    agents: 2, autoPick: true, changesADay: null, dailyTokens: 100_000_000, hours: null, shipFirst: true, shipFirstAt: 8, reviewOnFinish: false, reviewPulls: 'none',
  }, "hobkin's defaults for a home that set nothing")

  const set = await runCommand(handlers, 'work.workload', { changesADay: 3, hours: { from: '22:00', to: '06:00' }, shipFirst: false, shipFirstAt: 12, reviewOnFinish: true, reviewPulls: 'both', autoPick: false })
  const expected = { agents: 2, autoPick: false, changesADay: 3, dailyTokens: 100_000_000, hours: { from: '22:00', to: '06:00' }, shipFirst: false, shipFirstAt: 12, reviewOnFinish: true, reviewPulls: 'both' }
  assert.deepEqual(set, { ok: true, value: expected })
  assert.deepEqual(calls, [['refresh']], 'the window hears of it at once')
  assert.deepEqual((await stateOf(root)).workload, expected)
  // What a host started again reads: hobkin's file itself.
  assert.deepEqual(workloadOf(JSON.parse(readFileSync(modeFile(root), 'utf8'))), expected)

  // Any subset, and no cap and always are settings too.
  const back = await runCommand(handlers, 'work.workload', { changesADay: null, hours: null })
  assert.deepEqual(back.ok && [(back.value as typeof expected).changesADay, (back.value as typeof expected).hours, (back.value as typeof expected).shipFirstAt], [null, null, 12])
})

test('work.workload takes only what it can keep, checked before anything is written', async (t) => {
  const root = temporaryDirectory(t)
  const { handlers } = handlersOf(root)
  await runCommand(handlers, 'work.workload', { changesADay: 5 })

  for (const args of [
    {},
    { changesADay: 0 },
    { changesADay: 2.5 },
    { hours: { from: '9:00', to: '18:00' } },
    { hours: { from: '09:00', to: '24:00' } },
    { hours: { from: '09:00', to: '09:00' } },
    { hours: { from: '09:00' } },
    { shipFirstAt: 0 },
    { reviewPulls: 'all' },
    { agents: 4 },
    { changesADay: 3, dailyTokens: 5 },
  ]) {
    const outcome = await runCommand(handlers, 'work.workload', args)
    assert.equal(!outcome.ok && outcome.error.code, 'invalid-arguments', JSON.stringify(args))
  }
  assert.equal((await stateOf(root)).workload?.changesADay, 5, 'nothing refused was written')

  // Agents and tokens a day keep their own commands, and neither new command takes anything that could pass for a key.
  for (const name of ['work.workload', 'work.allowance'] as const) {
    assert.equal(COMMANDS[name].runs, 'host')
    assert.deepEqual(Object.keys((COMMANDS[name].args as { properties: object }).properties).filter((property) => /key|token|secret|password|credential/i.test(property)), [], name)
  }
  assert.equal(COMMANDS['work.workload'].hobkin, true, 'hobkin may set it, as it sets agents and tokens')
  assert.equal('hobkin' in COMMANDS['work.allowance'], false, 'only the user raises today\'s tokens')
  assert.equal(checkArguments('work.allowance', { at: 'yesterday' }).ok, false)
})

test('the work state says what holds work mode and until when, with the outlook, from hobkin itself', async (t) => {
  const root = temporaryDirectory(t)
  const { handlers } = handlersOf(root)
  assert.deepEqual((await stateOf(root)).holding, { kind: 'off', until: null, line: 'Work mode is off, so nothing starts by itself.' })

  // With auto-pick on, so the hours are what holds it.
  await runWorkCommand(root, ['start', temporaryDirectory(t), '--auto'])
  const from = clockIn(1)
  await runCommand(handlers, 'work.workload', { hours: { from, to: clockIn(2) } })
  const work = await stateOf(root)

  assert.equal(work.holding?.kind, 'hours')
  assert.equal(work.holding?.until, nextTime(from))
  assert.match(work.holding?.line ?? '', new RegExp(`^Work hours are ${from} to \\d\\d:\\d\\d, so nothing new starts until ${from} (today|tomorrow)\\.$`))
  assert.deepEqual(work.outlook, { startedToday: 0, moreToday: 0, nextAt: null }, 'only the look for projects is queued, and it is no change')
  assert.equal(work.allowance, null)
  // The words that were there stay.
  assert.match(work.forecast ?? '', /^Next 8h: /)

  // A hobkin older than these sends none of them, and the window draws without them.
  const older = workFrom({ work: { enabled: true, agents: 2, agentsAllowed: 2, plan: [], projects: [] }, waiting: null })!
  assert.deepEqual(['workload', 'holding', 'outlook', 'allowance'].filter((field) => field in older), [])
})

test("an open allowance request is on the work state, and the window's answer adds today's amount again, once for the request", async (t) => {
  const root = temporaryDirectory(t)
  const { handlers, calls } = handlersOf(root)
  await runWorkCommand(root, ['start', temporaryDirectory(t)])
  const at = new Date().toISOString()
  const asked = { day: new Date().toDateString(), at, limit: 100_000_000, proposed: 200_000_000, used: 100_000_000, hourShare: 16_666_667, atLimit: true, reason: 'Paused for today.' }
  writeFileSync(modeFile(root), JSON.stringify({ ...JSON.parse(readFileSync(modeFile(root), 'utf8')), allowanceRequest: asked }))

  assert.deepEqual((await stateOf(root)).allowance, { at, limit: 100_000_000, proposed: 200_000_000, used: 100_000_000 })

  const raised = await runCommand(handlers, 'work.allowance', { at })
  assert.deepEqual(raised, { ok: true, value: { tokens: 200_000_000 } })
  assert.deepEqual(calls, [['allow']], "hobkin's own work action answers it")
  const after = await stateOf(root)
  assert.deepEqual([after.dailyTokens, after.allowance], [200_000_000, null])

  const again = await runCommand(handlers, 'work.allowance', { at })
  assert.equal(!again.ok && again.error.code, 'failed')
  assert.match(!again.ok ? again.error.message : '', /answered already/)
  assert.equal((await stateOf(root)).dailyTokens, 200_000_000, 'a second click raises nothing')
  assert.deepEqual(calls, [['allow']])
})

test('with a hobkin older than the workload, the host still answers: the state leaves the workload out and work.workload says this hobkin has none', async (t) => {
  const root = temporaryDirectory(t)
  const { app, calls } = fakeHobkin(root)
  // An older hobkin's store has no workload functions.
  const handlers = workHandlers({ app: () => app, root: () => root, workload: {} })

  const outcome = await runCommand(handlers, 'work.workload', { changesADay: 3 })
  assert.deepEqual(outcome, { ok: false, error: { code: 'unavailable', message: 'This hobkin keeps no workload yet. Update hobkin to set it from here.' } })
  assert.deepEqual(calls, [], 'nothing was written or refreshed')
  assert.equal(workFrom({ work: { enabled: false, agents: 2, agentsAllowed: 2, plan: [], projects: [] }, waiting: null })!.workload, undefined)
})
