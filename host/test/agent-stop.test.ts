import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentSchedule } from '#shared/protocol/schedules.ts'
import type { RunSummary } from '#shared/protocol/snapshot.ts'
import { agentHandlers, type AgentsApp } from '../src/agents.ts'
import { runCommand } from '../src/commands.ts'

const RUNS: RunSummary[] = [
  { id: 'session:deploy', kind: 'background', state: 'waiting', title: 'Watch the deploy', scheduleId: 'session.deploy', waitUntil: '2026-11-22T00:10:00.000Z', waitNote: 'Read the monitoring again.', waits: 1 },
  { id: 'session:done', kind: 'background', state: 'completed', title: 'Old' },
]

/** hobkin's application as far as stopping and telling agents goes: it records each kill and each message. */
function fakeApp() {
  const calls: unknown[][] = []
  const app = {
    workAction: async (...args: unknown[]) => (calls.push(['work', ...args]), { message: 'Stopped.' }),
    kill: async (run: string) => (calls.push(['kill', run]), true),
    runner: { messageCheck: async (request: unknown) => (calls.push(['message', request]), { running: [{ scheduleId: 'session.deploy' }] }) },
  } satisfies AgentsApp
  return { calls, handlers: agentHandlers({ app: () => app, runs: () => RUNS }) }
}

test('a run that waits for its time is stopped through hobkin kill, as a running one is', async () => {
  const { calls, handlers } = fakeApp()

  const stopped = await runCommand(handlers, 'agent.stop', { run: 'session:deploy' })

  assert.deepEqual(stopped, { ok: true, value: { message: 'Stopped "Watch the deploy".' } })
  assert.deepEqual(calls, [['kill', 'session:deploy']])
})

test('a run that waits takes no message and no new model until it carries on, and an ended one is still not stopped', async () => {
  const { calls, handlers } = fakeApp()

  const said = await runCommand(handlers, 'agent.say', { run: 'session:deploy', text: 'Look now' })
  const changed = await runCommand(handlers, 'agent.change', { run: 'session:deploy', model: 'opus' })
  const ended = await runCommand(handlers, 'agent.stop', { run: 'session:done' })

  assert.deepEqual(said, { ok: false, error: { code: 'unavailable', message: 'It waits for its time, so nothing reaches it until it carries on.' } })
  assert.deepEqual(changed, { ok: false, error: { code: 'unavailable', message: 'That agent is not working.' } })
  assert.deepEqual(ended, { ok: false, error: { code: 'unavailable', message: 'It had already finished, so nothing was stopped.' } })
  assert.deepEqual(calls, [])
})

test('a run that waits on its schedule names the schedule that will wake it, and one whose schedules ended waits for its time', async () => {
  const app = {
    workAction: async () => ({}),
    kill: async () => true,
    runner: { messageCheck: async () => ({ running: [] }) },
  } satisfies AgentsApp
  const ship: RunSummary = { id: 'session:ship', kind: 'background', state: 'waiting', title: 'Ship 412', scheduleId: 'session.ship' }
  const say = (schedules: AgentSchedule[]) => runCommand(agentHandlers({ app: () => app, runs: () => [ship], schedules: () => schedules }), 'agent.say', { run: 'session:ship', text: 'Look now' })
  const words = (said: unknown) => (said as { error?: { message: string } }).error?.message

  const ended: AgentSchedule = { id: 'sch-0', owner: { kind: 'run', id: 'session:ship' }, name: 'Old watch', state: 'done' }
  const later: AgentSchedule = { id: 'sch-1', owner: { kind: 'run', id: 'session:ship' }, name: 'Nightly check', state: 'waiting', nextAt: '2026-11-23T23:00:00.000Z' }
  const soon: AgentSchedule = { id: 'sch-2', owner: { kind: 'run', id: 'session:ship' }, name: 'Watch CI for #412', state: 'waiting', nextAt: '2026-11-23T16:02:00.000Z' }
  const another: AgentSchedule = { id: 'sch-3', owner: { kind: 'run', id: 'session:other' }, name: 'Not its own', state: 'waiting', nextAt: '2026-11-23T16:00:00.000Z' }

  assert.equal(words(await say([ended, later, soon, another])), 'It waits for its schedule "Watch CI for #412" to wake it, so nothing reaches it until then.')
  assert.equal(words(await say([{ ...soon, name: undefined, state: 'paused', nextAt: undefined }])), 'It waits for one of its schedules to wake it, so nothing reaches it until then.')
  assert.equal(words(await say([ended, another])), 'It waits for its time, so nothing reaches it until it carries on.')
})
