import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HobkinApplication, type HarnessRequest, type PiSessionEvent } from 'hobkin/src/cli/application.mjs'
import { initialize, setTelemetryUpload } from 'hobkin/src/cli/config.mjs'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import type { StateMessage } from '#shared/protocol/messages.ts'
import { exchangeOf, pauseOf } from '../../ui/src/features/agent-activity/steps.ts'
import { agentsFrom, childrenFrom } from '../../ui/src/lib/host/frame.ts'
import { applyHostMessage, initialHostState, type HostState } from '../../ui/src/lib/host/state.ts'
import { ActivityKeeper } from '../src/activity.ts'
import { builtInReply, createScriptedModel } from '../src/scripted.ts'
import { StateSync } from '../src/state-sync.ts'
import { afterTest, temporaryDirectory } from './support.ts'

type HarnessCallbacks = {
  onEvent: (event: PiSessionEvent) => void
  onReady: (send: (message: string) => Promise<void>) => void
}

type WorkApplication = HobkinApplication & {
  director: {
    start: (options: Record<string, unknown>) => void
    running: () => { id: string }[]
    closing: Promise<void>
    panes?: { launch: () => never }
  }
  runner: { messageCheck: (request: { scheduleId?: string; message?: string }) => Promise<unknown> }
}

function deferred<Value>() {
  let resolve: (value: Value) => void = () => {}
  const promise = new Promise<Value>((done) => { resolve = done })
  return { promise, resolve }
}

const owner = { state: 'live', limits: { images: 4, imageBytes: 1024 } } as const
const signIn = { status: 'signed-in' } as const
const messageStart = { type: 'message_start', message: { role: 'assistant', content: [] } }
const delta = (text: string): PiSessionEvent => ({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: text } })

// The application's real runner/durable dispatch and its actual snapshot adapters. No socket, provider or tool executes.
test('background Work streams through the application and host to the agent exchange, including its final batched events', { timeout: 15000 }, async (t) => {
  const root = temporaryDirectory(t)
  initialize(root, { cwd: root })
  setTelemetryUpload(root, false)
  const model = await createScriptedModel(root, { reply: builtInReply })
  const ready = deferred<{ request: HarnessRequest; callbacks: HarnessCallbacks }>()
  const finish = deferred<{ status: string; text: string }>()
  const heard: string[] = []
  const keeper = new ActivityKeeper()
  const sync = new StateSync({ owner, signIn, models: null })
  let client: HostState = { ...initialHostState, home: root }
  const sent: StateMessage[] = []
  const app = await HobkinApplication.open(root, {
    createMain: model.createMain,
    sessionDependencies: model.dependencies,
    intervalMs: 60000,
    fetch: async () => { throw Error('No network in this test.') },
    runHarness: async (request, options) => {
      const callbacks = options as HarnessCallbacks
      callbacks.onReady(async (message) => { heard.push(message) })
      ready.resolve({ request, callbacks })
      return finish.promise
    },
    onChange: (snapshot) => {
      const update = sync.update({ owner, signIn, models: null, snapshot: keeper.keep(snapshot) })
      if (update) {
        sent.push(update)
        client = applyHostMessage(client, JSON.parse(JSON.stringify(update)))
      }
    },
  }) as WorkApplication
  afterTest(t, async () => {
    finish.resolve({ status: 'interrupted', text: 'Fixture cleanup.' })
    await app.close()
  })
  app.director.start({
    key: 'fixture:do', lane: 'do', slug: 'fixture', item: 'fix', title: 'fixture: Fix login', purpose: 'work-do',
    cwd: root, level: 'important', model: 'fixture/model', effort: 'high', instructions: 'Fixture only.', work: () => ({}),
  })
  const { request, callbacks } = await ready.promise
  const [{ id }] = app.director.running()
  assert.equal(request.harness, 'pi')
  assert.equal(request.cwd, root)
  assert.match(id, /^work:fixture:do:/)
  await app.refresh()
  assert.equal(agentsFrom(client.snapshot)[0]?.id, id)

  const entries = () => (client.snapshot.jobActivity as Record<string, ActivityEntry[]>)[id] ?? []
  callbacks.onEvent(messageStart)
  callbacks.onEvent({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex: 1, delta: 'private reasoning' } })
  await app.refresh()
  assert.equal(pauseOf(entries(), {}), 'thinking')
  callbacks.onEvent(delta('Reading **login**'))
  await app.refresh()
  assert.equal(entries()[0]?.text, 'Reading **login**')
  callbacks.onEvent(delta('\n  now.'))
  await app.refresh()
  assert.equal(entries()[0]?.text, 'Reading **login**\n  now.')
  assert.deepEqual(sent.at(-1)?.activity?.map((step) => step.op), ['update'], 'only the growing entry travels')
  callbacks.onEvent({ type: 'tool_execution_start', toolCallId: 'read', toolName: 'read', args: { path: 'src/login.ts' } })
  await app.refresh()
  assert.equal(agentsFrom(client.snapshot)[0]?.doing, 'running read')
  await app.runner.messageCheck({ scheduleId: 'work.fixture.do', message: 'Keep the whitespace.' })
  assert.deepEqual(heard, ['Keep the whitespace.'])
  // The lead spawns two teams agents in its own Pi. Only teams' spawn details reach this stream, never theirs.
  // They travel as the run's teams agents, never as its helpers (`046-teams-layer`).
  callbacks.onEvent({ type: 'tool_execution_end', toolCallId: 'spawn', toolName: 'spawn_swarm_agents', isError: false, result: { content: [{ type: 'text', text: 'Spawned 2/2.' }], details: { session: 'private', spawned: [{ name: 'scout', role: 'read' }, { name: 'fixer', role: 'write', queued: true, queuePosition: 1 }], failed: [] } } })
  await app.refresh()
  const teamsStates = () => (client.snapshot.teamsAgents?.[id] ?? []).map(({ name, state }) => [name, state])
  assert.deepEqual(teamsStates(), [['scout', 'running'], ['fixer', 'queued']])
  assert.deepEqual(childrenFrom(client.snapshot, id), [])

  // Completion and its last events arrive before the coalesced application refresh.
  callbacks.onEvent({ type: 'tool_execution_end', toolCallId: 'read', toolName: 'read', isError: false, result: { content: [{ type: 'text', text: 'export const login = true\n' }] } })
  callbacks.onEvent({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Reading **login**\n  now.' }] } })
  callbacks.onEvent(messageStart)
  callbacks.onEvent(delta('Finished.\n\n  Exact final text.'))
  finish.resolve({ status: 'completed', text: 'Useful: Fixture finished.' })
  await app.director.closing
  await app.refresh()
  assert.deepEqual(entries().map(({ kind, text, state, output }) => ({ kind, text, state, output })), [
    { kind: 'assistant', text: 'Reading **login**\n  now.', state: undefined, output: undefined },
    { kind: 'tool', text: undefined, state: 'completed', output: 'export const login = true\n' },
    { kind: 'tool', text: undefined, state: 'completed', output: 'Spawned 2/2.' },
    { kind: 'assistant', text: 'Finished.\n\n  Exact final text.', state: undefined, output: undefined },
  ])
  assert.equal(agentsFrom(client.snapshot).length, 0)
  await app.refresh() // The application releases it; the host retains the final feed.
  client = applyHostMessage({ ...initialHostState, home: root }, JSON.parse(JSON.stringify(sync.full())))
  // No report was seen from either before the run ended, so how they ended is not known.
  assert.deepEqual(teamsStates(), [['scout', 'unknown'], ['fixer', 'unknown']], 'a reconnect gets the ended run whole')
  assert.doesNotMatch(JSON.stringify(client.snapshot.teamsAgents), /private/)
  assert.equal(agentsFrom(client.snapshot, { includeEnded: true }).find((agent) => agent.id === id)?.title, 'fixture: Fix login')
  const exchange = exchangeOf(entries(), [], { ended: true, cwd: root, seenAt: () => undefined })
  assert.deepEqual(exchange.map((step) => step.kind), ['says', 'looks', 'tool', 'says'])
  const last = exchange.at(-1)
  assert.equal(last?.kind === 'says' && last.text, 'Finished.\n\n  Exact final text.')
  assert.equal(pauseOf(entries(), { ended: true }), null)
  await assert.rejects(app.runner.messageCheck({ scheduleId: 'work.fixture.do', message: 'Too late.' }), /not running/)
})
