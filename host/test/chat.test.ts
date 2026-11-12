import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { atomicJson, initialize } from 'hobkin/src/cli/config.mjs'
import type { ScriptedCall } from '../src/scripted.ts'
import type { HobkinApplication } from 'hobkin/src/cli/application.mjs'
import type { StopExecutionArgs } from '#shared/commands/registry.ts'
import { HomeOwner } from '../src/owner.ts'
import { runCommand } from '../src/commands.ts'
import { StateSync } from '../src/state-sync.ts'
import { afterTest, Client, hostFor, temporaryDirectory, type View } from './support.ts'

type RawStop = Awaited<ReturnType<HobkinApplication['stopExecution']>>
const stopReceipt = ({ kind, runId, agentId, mode, attemptId }: Parameters<HobkinApplication['stopExecution']>[0]): RawStop => ({
  target: { kind, runId, ...(agentId ? { agentId } : {}) }, mode, attemptId,
  stop: { status: 'unknown' }, closure: { status: 'unsupported' },
  descendants: { status: 'unknown', agents: [], cleanupScope: 'none', detachedCleanup: 'unknown' }, queueRecovery: { status: 'unknown' },
})

function executionFixture() {
  const owner = new HomeOwner({ root: '/isolated/home', live: false, real: false, onChange() {}, onSessionEvent() {} })
  const control = { kind: 'agent' as const, runId: 'root-run', agentId: 'nested-uuid', parentId: 'parent-uuid', rootId: 'root-run', label: 'Child', canStop: true, canForce: true }
  const calls: Parameters<HobkinApplication['stopExecution']>[0][] = []
  const app = {
    snapshot: { connection: 'connected', busy: false, runs: [], stopControls: { targets: [control] } },
    stopExecution: async (args: Parameters<HobkinApplication['stopExecution']>[0]) => { calls.push(args); return stopReceipt(args) },
  } as unknown as HobkinApplication
  owner.app = app
  owner.snapshot = app.snapshot
  return { owner, app, calls, control }
}

test('execution Stop stamps only current live custody and rejects stale authority', async (t) => {
  t.mock.method(HomeOwner.prototype, 'start', () => assert.fail('must not start a real application'))
  const { stopExecution } = await import('../src/host.ts')
  assert.equal(typeof stopExecution, 'function')
  const { owner, app, calls, control } = executionFixture()
  const captured = owner.captureExecution()!
  const target = { home: captured.home, epoch: captured.epoch, kind: control.kind, runId: control.runId, agentId: control.agentId }
  const args: StopExecutionArgs = { target, mode: 'force', attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
  const handlers = { 'execution.stop': (request: StopExecutionArgs) => stopExecution(owner, request) }
  assert.deepEqual(owner.wireSnapshot()?.stopControls, { home: captured.home, epoch: captured.epoch, targets: [control] })
  assert.equal(owner.captureExecution()?.epoch, captured.epoch)
  const facts = { owner: { state: 'live', limits: { images: 1, imageBytes: 1 } } as const, signIn: { status: 'signed-in' } as const, models: null }
  const sync = new StateSync(facts)
  sync.update({ ...facts, snapshot: owner.wireSnapshot() })
  assert.deepEqual(sync.full().set?.stopControls, owner.wireSnapshot()?.stopControls)
  const result = await runCommand(handlers, 'execution.stop', args)
  assert.deepEqual(result, { ok: true, value: { ...stopReceipt({ ...control, ...args }), target } })
  assert.deepEqual(calls, [{ kind: 'agent', runId: 'root-run', agentId: 'nested-uuid', mode: 'force', attemptId: args.attemptId }])
  for (const changed of [{ home: '/other' }, { epoch: 'old-app' }]) {
    const refused = await runCommand(handlers, 'execution.stop', { ...args, target: { ...target, ...changed } })
    assert.equal(!refused.ok && refused.error.code, 'unavailable')
  }
  assert.equal(calls.length, 1)
  await stopExecution(owner, { ...args, target: { home: target.home, epoch: target.epoch, kind: 'run', runId: target.runId }, how: 'not-approved' })
  assert.deepEqual(calls[1], { kind: 'run', runId: 'root-run', mode: 'force', attemptId: args.attemptId, how: 'not-approved' })
  app.stopExecution = async (request) => ({ ...stopReceipt(request), target: { kind: request.kind, runId: request.runId, agentId: 'other-owned-child' } })
  assert.equal((await runCommand(handlers, 'execution.stop', args)).ok, false, 'another nested child cannot satisfy the receipt')
  app.snapshot.connection = 'offline'
  assert.equal(owner.wireSnapshot()?.stopControls, undefined)
  assert.deepEqual(sync.update({ ...facts, snapshot: owner.wireSnapshot() })?.unset, ['stopControls'])
  app.snapshot.connection = 'connected'
  owner.app = { ...app, snapshot: { ...app.snapshot } } as HobkinApplication
  assert.notEqual(owner.captureExecution()?.epoch, captured.epoch)
  assert.equal(owner.wireSnapshot()?.stopControls, undefined, 'a previous app projection cannot regain authority')
  assert.equal((await runCommand(handlers, 'execution.stop', args)).ok, false)
  owner.app = null
  assert.equal(owner.wireSnapshot()?.stopControls, undefined)
})

test('execution Stop preserves independent receipts and Force does not wait for Stop', async (t) => {
  t.mock.method(HomeOwner.prototype, 'start', () => assert.fail('must not start a real application'))
  const { stopExecution } = await import('../src/host.ts')
  assert.equal(typeof stopExecution, 'function')
  const { owner, app } = executionFixture()
  const { home, epoch } = owner.captureExecution()!
  const args: StopExecutionArgs = { target: { home, epoch, kind: 'main', runId: 'captured-main' }, mode: 'stop', attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
  let release!: (receipt: RawStop) => void
  const pending = new Promise<RawStop>((resolve) => { release = resolve })
  app.stopExecution = (request) => request.mode === 'stop' ? pending : Promise.resolve(stopReceipt(request))
  const stopping = stopExecution(owner, args)
  const forceArgs = { ...args, mode: 'force' as const, attemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
  const forced = await stopExecution(owner, forceArgs)
  assert.equal(forced.closure.status, 'unsupported')
  assert.deepEqual(forced.queueRecovery, { status: 'unknown' })
  assert.equal(forced.attemptId, forceArgs.attemptId)
  owner.app = executionFixture().app
  owner.app.stopExecution = async () => { throw Error('must not retarget the new main') }
  release({ ...stopReceipt({ ...args.target, ...args }), queueRecovery: { status: 'confirmed', unsent: [], alreadyReturned: true } })
  const stopped = await stopping
  assert.deepEqual(stopped.target, args.target)
  assert.deepEqual(stopped.queueRecovery, { status: 'confirmed', unsent: [], alreadyReturned: true })
  owner.app = app
  args.target.epoch = owner.captureExecution()!.epoch
  const handlers = { 'execution.stop': (request: StopExecutionArgs) => stopExecution(owner, request) }
  const confirmed: RawStop = { ...stopReceipt({ ...args.target, ...args }), stop: { status: 'confirmed' }, closure: { status: 'confirmed' },
    descendants: { status: 'unknown', agents: [{ agentId: 'child-a', status: 'confirmed' }, { agentId: 'child-b', status: 'unknown' }], cleanupScope: 'captured-rpc-children', detachedCleanup: 'unknown' },
    queueRecovery: { status: 'confirmed', unsent: ['unread draft'] }, message: 'Captured transport closed; child closure is unknown.' }
  app.stopExecution = async () => confirmed
  assert.deepEqual(await stopExecution(owner, args), { ...confirmed, target: args.target })
  for (const changed of [{ target: { kind: 'main', runId: 'new-main' } }, { target: { kind: 'agent', runId: args.target.runId, agentId: 'other' } }, { mode: 'force' }, { attemptId: forceArgs.attemptId }]) {
    app.stopExecution = async (request) => ({ ...stopReceipt(request), ...changed }) as RawStop
    assert.equal((await runCommand(handlers, 'execution.stop', args)).ok, false)
  }
  app.stopExecution = async () => { throw Error('runtime unavailable') }
  assert.deepEqual(await runCommand(handlers, 'execution.stop', args), { ok: false, error: { code: 'failed', message: 'runtime unavailable' } })
})

const said = (view: View) => view.messages.map(({ role, content }) => `${role}: ${content}`)
const mainRuns = (view: View) => (view.snapshot.runs ?? []).filter((run) => run.kind === 'main')

/** A model whose first reply waits until the test lets it go. */
function heldModel() {
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  const calls: ScriptedCall[] = []
  return {
    calls,
    release: () => release(),
    reply: async (call: ScriptedCall) => {
      calls.push(call)
      if (call.index === 0) await gate
      return { text: `Reply ${call.index + 1}` }
    },
  }
}

test('a send during a turn steers it', async (t) => {
  const model = heldModel()
  const host = await hostFor(t, { scripted: { reply: model.reply } })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.live()

  const first = await client.run<{ id: string; queued: boolean }>('conversation.send', { text: 'Plan the week' })
  assert.equal(first.queued, false)
  await client.until((view) => view.snapshot.busy === true && model.calls.length === 1, 'the turn to start')

  // The turn is running, so this one is taken into it. hobkin accepts it before the model has read it.
  const steer = await client.run<{ id: string; queued: boolean }>('conversation.send', { text: 'Only weekdays' })
  assert.equal(steer.queued, true)
  assert.deepEqual(said(client.view), ['user: Plan the week'], 'the model has not read it yet')

  model.release()
  const view = await client.until((now) => now.snapshot.busy === false && now.messages.length === 4, 'the steered turn to end')
  assert.deepEqual(said(view), ['user: Plan the week', 'assistant: Reply 1', 'user: Only weekdays', 'assistant: Reply 2'])
  assert.equal(model.calls.length, 2, 'one more model call, in the same turn')
  assert.ok(model.calls[1]!.prompt.endsWith('Only weekdays'))

  // One turn, and the steering message belongs to it.
  assert.deepEqual(mainRuns(view).map(({ title, state }) => `${title}: ${state}`).sort(), ['Conversation: completed', 'Steering: completed'])
})

test('interrupt returns unsent text', async (t) => {
  const model = heldModel()
  const host = await hostFor(t, { scripted: { reply: model.reply } })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.live()

  assert.deepEqual(await client.run('conversation.stop'), { stopped: false, unsent: [] }, 'with no turn running there is nothing to stop')

  await client.run('conversation.send', { text: 'Plan the week' })
  await client.until((view) => view.snapshot.busy === true && model.calls.length === 1, 'the turn to start')
  await client.run('conversation.send', { text: 'Only weekdays' })
  await client.run('conversation.send', { text: 'And skip Friday' })

  // What hobkin had not read comes back as the user typed it, for the input to take again.
  assert.deepEqual(await client.run('conversation.stop'), { stopped: true, unsent: ['Only weekdays', 'And skip Friday'] })

  const view = await client.until((now) => now.snapshot.busy === false && now.messages.some((message) => message.role === 'system'), 'the stop to show')
  assert.deepEqual(said(view), ['user: Plan the week', 'system: You stopped hobkin.'])
  assert.equal(view.snapshot.doing, null)
  assert.equal(model.calls.length, 1, 'the model never saw what was unsent')
  assert.deepEqual([...new Set(mainRuns(view).map(({ state }) => state))], ['interrupted'])

  // The conversation goes on from where it stopped.
  model.release()
  await client.run('conversation.send', { text: 'Start over' })
  const after = await client.until((now) => now.snapshot.busy === false && now.messages.at(-1)?.role === 'assistant', 'the next reply')
  assert.equal(after.messages.at(-1)?.content, 'Reply 2')
})

test('a message about a report carries the report to hobkin', async (t) => {
  // A report on record, as an imported one is: hobkin lists it with the rest.
  const root = join(temporaryDirectory(t), 'home')
  initialize(root, { cwd: root })
  const report = { id: 'local:recap:1', title: 'Morning recap', body: 'Two builds failed overnight: checkout and billing.', at: '2026-11-09T07:00:00Z', outcome: 'imported', origin: 'legacy-state', path: '/recap.md', readState: 'read', readAt: '2026-11-09T08:00:00Z' }
  atomicJson(join(root, 'runtime', 'imported-reports.json'), { version: 1, reports: [report] })

  const prompts: string[] = []
  const host = await hostFor(t, { root, scripted: { reply: ({ prompt }) => (prompts.push(prompt), { text: 'About that recap.' }) } })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  const view = await client.live()
  assert.ok((view.snapshot.reports as { id: string }[]).some(({ id }) => id === report.id))

  // The same path as `r` on a report in the terminal app: hobkin puts the report ahead of the words.
  await client.run('conversation.send', { text: 'Which one should I look at first?', report: report.id })
  const replied = await client.until((now) => now.snapshot.busy === false && now.messages.length === 2, 'the reply')
  assert.equal(prompts.length, 1)
  assert.match(prompts[0]!, /<hobkin-report>[\s\S]*"title":"Morning recap"[\s\S]*Two builds failed overnight[\s\S]*<\/hobkin-report>[\s\S]*Which one should I look at first\?$/)
  // The conversation shows the words and what they were about, not the report itself.
  assert.deepEqual(
    replied.messages.map(({ role, content, about }) => [role, content, about]),
    [
      ['user', 'Which one should I look at first?', 'Morning recap'],
      ['assistant', 'About that recap.', undefined],
    ],
  )

  // A report that is not on record is refused, and nothing is sent.
  const gone = await client.command('conversation.send', { text: 'And this one?', report: 'nowhere' })
  assert.equal(!gone.ok && gone.error.code, 'unavailable')
  assert.match(!gone.ok ? gone.error.message : '', /report is not in hobkin's list/)
  assert.equal(prompts.length, 1)
})
