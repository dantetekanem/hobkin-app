import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DurableHobkins } from 'hobkin/src/cli/application.mjs'
import { checkArguments } from '#shared/commands/registry.ts'
import type { RunSummary } from '#shared/protocol/snapshot.ts'
import { agentHandlers, type AgentsApp } from '../src/agents.ts'
import { runCommand } from '../src/commands.ts'
import { hobkinHandlers } from '../src/hobkins.ts'

const RUNS: RunSummary[] = [{ id: 'once:recap', title: 'Morning recap', state: 'running', kind: 'background', scheduleId: 'morning-recap' }]
const NOTE = '00000000-0000-4000-8000-000000000001'

/** A runner whose running check takes messages and gives back what waits, as hobkin's does. */
function agentsApp({ takesBack = true } = {}) {
  const asked: Record<string, unknown>[] = []
  const runner: AgentsApp['runner'] = {
    messageCheck: async (request) => {
      if (!request.scheduleId) return { running: [{ scheduleId: 'morning-recap' }] }
      asked.push(request)
      return { scheduleId: request.scheduleId, status: 'queued', ...(request.queue === 'interrupt' ? { unsent: [{ noteId: NOTE, text: 'Only weekdays' }] } : {}) }
    },
    ...(takesBack ? { takeBack: async () => ({ scheduleId: 'morning-recap', unsent: [{ text: 'Then sum it up' }] }) } : {}),
  }
  const app: AgentsApp = { workAction: async () => ({}), kill: async () => true, runner }
  return { asked, handlers: agentHandlers({ app: () => app, runs: () => RUNS }) }
}

test("a message to a working agent waits as the user chose, and an interrupting one gives back what the turn never read", async () => {
  const { asked, handlers } = agentsApp()

  assert.deepEqual(await runCommand(handlers, 'agent.say', { run: 'once:recap', text: 'Then sum it up', queue: 'follow-up' }), { ok: true, value: { queued: true } })
  const interrupted = await runCommand(handlers, 'agent.say', { run: 'once:recap', text: 'Do this instead', queue: 'interrupt' })

  assert.deepEqual(asked.map(({ queue }) => queue), ['follow-up', 'interrupt'])
  assert.deepEqual(interrupted, { ok: true, value: { queued: true, unsent: [{ noteId: NOTE, text: 'Only weekdays' }] } })
  assert.equal(checkArguments('agent.say', { run: 'once:recap', text: 'x', queue: 'sideways' }).ok, false)
})

test("what waits for a working agent's turn comes back for the input, and a runtime without the way says so", async () => {
  assert.deepEqual(await runCommand(agentsApp().handlers, 'agent.dequeue', { run: 'once:recap' }), { ok: true, value: { unsent: [{ text: 'Then sum it up' }] } })

  const old = await runCommand(agentsApp({ takesBack: false }).handlers, 'agent.dequeue', { run: 'once:recap' })
  assert.equal(!old.ok && old.error.code, 'unavailable')
})

test("a durable hobkin's turn takes the message as the user chose, and gives back what waits for it", async () => {
  const said: unknown[] = []
  const hobkins = {
    say: async (_id: string, args: { queue?: string }) => {
      said.push(args)
      return { started: false, queued: true, run: 'hobkin:a1b2c3d4:2', ...(args.queue === 'interrupt' ? { unsent: [{ text: 'Only weekdays' }] } : {}) }
    },
    takeBack: async () => ({ unsent: [{ noteId: NOTE, text: 'Then sum it up' }] }),
  } as unknown as DurableHobkins
  const handlers = hobkinHandlers({ app: () => ({ hobkins }), claudeMissing: async () => null, modelProblem: () => null })

  const interrupted = await runCommand(handlers, 'hobkin.say', { id: 'a1b2c3d4', text: 'Do this instead', queue: 'interrupt' })
  const dequeued = await runCommand(handlers, 'hobkin.dequeue', { id: 'a1b2c3d4' })

  assert.deepEqual(said, [{ text: 'Do this instead', queue: 'interrupt' }])
  assert.deepEqual(interrupted, { ok: true, value: { started: false, queued: true, run: 'hobkin:a1b2c3d4:2', unsent: [{ text: 'Only weekdays' }] } })
  assert.deepEqual(dequeued, { ok: true, value: { unsent: [{ noteId: NOTE, text: 'Then sum it up' }] } })

  const old = await runCommand(hobkinHandlers({ app: () => ({ hobkins: {} as DurableHobkins }), claudeMissing: async () => null, modelProblem: () => null }), 'hobkin.dequeue', { id: 'a1b2c3d4' })
  assert.equal(!old.ok && old.error.code, 'unavailable')
})

test("what the user added to a run while it worked comes back for its page, and a runtime from before has none", async () => {
  const kept = [{ noteId: NOTE, text: 'Only weekdays', at: 5, queue: 'steer' as const, receivedAt: 6 }]
  const runner: AgentsApp['runner'] = { messageCheck: async () => null, notesOf: async (runId) => (runId === 'once:recap' ? kept : []) }
  const handlers = agentHandlers({ app: () => ({ workAction: async () => ({}), kill: async () => true, runner }), runs: () => RUNS })

  assert.deepEqual(await runCommand(handlers, 'agent.notes', { run: 'once:recap' }), { ok: true, value: { notes: kept } })
  assert.deepEqual(await runCommand(handlers, 'agent.notes', { run: 'once:other' }), { ok: true, value: { notes: [] } })
  assert.deepEqual(await runCommand(agentsApp().handlers, 'agent.notes', { run: 'once:recap' }), { ok: true, value: { notes: [] } })
})
