import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ModelChoice, ModelsState } from '#shared/protocol/models.ts'
import type { RunSummary } from '#shared/protocol/snapshot.ts'
import { agentHandlers, type AgentsApp } from '../src/agents.ts'
import { runCommand } from '../src/commands.ts'
import { hobkinHandlers } from '../src/hobkins.ts'
import { resolveModel } from '../src/model-name.ts'

const choice = (provider: string, id: string, name: string, thinking: string[] = ['low', 'medium', 'high']): ModelChoice => ({ provider, id, name, thinking, contextWindow: null })
const MODELS: ModelsState = {
  providers: [],
  models: [
    choice('anthropic', 'claude-opus-5', 'Claude Opus 5', ['low', 'medium', 'high', 'max']),
    choice('anthropic', 'claude-sonnet-5', 'Claude Sonnet 5'),
    choice('openai-codex', 'gpt-6.1-sol', 'GPT-6.1 Sol', ['low', 'medium', 'high', 'xhigh']),
    choice('openai-codex', 'gpt-6', 'GPT-6'),
    choice('openai', 'gpt-6', 'GPT-6'),
  ],
}

test('a short model name is made full: an exact id first, else a part of its id or name', () => {
  assert.deepEqual(resolveModel(MODELS.models, 'anthropic/claude-opus-5'), { model: 'anthropic/claude-opus-5' })
  assert.deepEqual(resolveModel(MODELS.models, 'opus'), { model: 'anthropic/claude-opus-5' })
  assert.deepEqual(resolveModel(MODELS.models, 'Sol'), { model: 'openai-codex/gpt-6.1-sol' })
  assert.deepEqual(resolveModel(MODELS.models, 'gpt-6.1-sol'), { model: 'openai-codex/gpt-6.1-sol' }, 'an exact id')
  assert.deepEqual(resolveModel(MODELS.models, 'gpt-6.1'), { model: 'openai-codex/gpt-6.1-sol' }, 'a part of an id')
})

test('an exact id wins over a longer one, several matches are listed up to five, and none says so', () => {
  const longer = [choice('a', 'gpt-6', 'GPT-6'), choice('a', 'gpt-6-mini', 'GPT-6 mini')]
  assert.deepEqual(resolveModel(longer, 'gpt-6'), { model: 'a/gpt-6' })
  assert.deepEqual(resolveModel(MODELS.models, 'gpt-6'), { problem: 'Several models match "gpt-6": openai-codex/gpt-6, openai/gpt-6. Say which, as provider/model.' })
  const many = Array.from({ length: 8 }, (_, n) => choice('p', `m${n}`, `M${n}`))
  const outcome = resolveModel(many, 'm') as { problem: string }
  assert.match(outcome.problem, /p\/m0, p\/m1, p\/m2, p\/m3, p\/m4 and 3 more/)
  assert.deepEqual(resolveModel(MODELS.models, 'zzz'), { problem: 'Pi can use no model that matches "zzz".' })
})

const RUNS = [
  { id: 'work:a', kind: 'work', state: 'running', title: 'A', model: 'anthropic/claude-sonnet-5', effort: 'medium' },
  { id: 'main', kind: 'main', state: 'running', title: 'hobkin' },
  { id: 'done', kind: 'job', state: 'completed', title: 'Old' },
] as unknown as RunSummary[]

function agents(changeRun?: (run: string, change: unknown) => Promise<unknown>) {
  const calls: unknown[][] = []
  const runtime = changeRun ? { changeRun: async (run: string, change: unknown) => (calls.push([run, change]), changeRun(run, change)) } : {}
  const handlers = agentHandlers({ app: () => ({ runtime }) as unknown as AgentsApp, runs: () => RUNS, models: async () => MODELS })
  return { handlers, calls }
}

test('a working agent is changed with a full model and only what was said, and the answer says what it works on', async () => {
  const { handlers, calls } = agents(async () => ({ model: 'anthropic/claude-opus-5', effort: 'medium' }))
  const outcome = await runCommand(handlers, 'agent.change', { run: 'work:a', model: 'opus' })
  assert.deepEqual(outcome, { ok: true, value: { message: 'It works on anthropic/claude-opus-5 at medium from its next step.' } })
  assert.deepEqual(calls, [['work:a', { model: 'anthropic/claude-opus-5' }]])
})

test('a level is checked against the model asked for, or the model the agent is on', async () => {
  const { handlers, calls } = agents(async () => ({ model: 'x', effort: 'x' }))
  const refused = await runCommand(handlers, 'agent.change', { run: 'work:a', effort: 'max' })
  assert.deepEqual(refused, { ok: false, error: { code: 'unavailable', message: 'Claude Sonnet 5 offers these thinking levels: low, medium, high.' } })
  const withModel = await runCommand(handlers, 'agent.change', { run: 'work:a', model: 'opus', effort: 'max' })
  assert.equal(withModel.ok, true)
  assert.deepEqual(calls, [['work:a', { model: 'anthropic/claude-opus-5', effort: 'max' }]])
})

test('a finished agent, hobkin\'s own conversation, an unknown model and nothing asked reach nothing', async () => {
  const { handlers, calls } = agents(async () => ({}))
  const refusal = async (args: Record<string, unknown>) => ((await runCommand(handlers, 'agent.change', args)) as { error?: { message: string } }).error?.message
  assert.equal(await refusal({ run: 'done', effort: 'low' }), 'That agent is not working.')
  assert.equal(await refusal({ run: 'main', effort: 'low' }), "hobkin's own conversation changes its model in Settings.")
  assert.equal(await refusal({ run: 'work:a', model: 'zzz' }), 'Pi can use no model that matches "zzz".')
  assert.equal(await refusal({ run: 'work:a' }), 'agent.change: arguments need a model or a thinking level to change.')
  assert.deepEqual(calls, [])
})

test('a runtime from before says to restart the app, and a runtime refusal is the reason', async () => {
  const { handlers } = agents()
  assert.deepEqual(await runCommand(handlers, 'agent.change', { run: 'work:a', effort: 'low' }), { ok: false, error: { code: 'unavailable', message: 'This hobkin cannot change a working agent yet. Restart the app to load it.' } })
  const { handlers: closed } = agents(async () => { throw Error('Its process has closed.') })
  assert.deepEqual(await runCommand(closed, 'agent.change', { run: 'work:a', effort: 'low' }), { ok: false, error: { code: 'unavailable', message: 'Its process has closed.' } })
})

function hobkins(changeEngine?: (id: string, change: unknown) => Promise<unknown>) {
  const calls: unknown[][] = []
  const runtime = {
    read: async () => ({ hobkin: { engine: { kind: 'pi', model: 'anthropic/claude-sonnet-5', effort: 'low' } }, turns: [] }),
    ...(changeEngine ? { changeEngine: async (id: string, change: unknown) => (calls.push([id, change]), changeEngine(id, change)) } : {}),
  }
  const handlers = hobkinHandlers({ app: () => ({ hobkins: runtime }) as never, claudeMissing: async () => null, modelProblem: () => null, models: async () => MODELS })
  return { handlers, calls }
}
const ENGINE = { kind: 'pi', model: 'anthropic/claude-opus-5', effort: 'low' }

test('a durable hobkin is changed through the hobkin, and the answer tells whether its turn took it', async () => {
  const id = 'a1b2c3d4'
  for (const [turn, message] of [
    [null, 'It will work on anthropic/claude-opus-5 at low from its next turn.'],
    [{ run: 'r', took: true, model: 'anthropic/claude-opus-5', effort: 'low' }, 'It works on anthropic/claude-opus-5 at low from its next step, and its later turns keep it.'],
    [{ run: 'r', took: false, reason: 'That agent is not working.' }, 'Its turn ended before it took the change. It will work on anthropic/claude-opus-5 at low from its next turn.'],
  ] as const) {
    const { handlers, calls } = hobkins(async () => ({ engine: ENGINE, turn }))
    assert.deepEqual(await runCommand(handlers, 'hobkin.change', { id, model: 'opus' }), { ok: true, value: { message } })
    assert.deepEqual(calls, [[id, { model: 'anthropic/claude-opus-5' }]])
  }
})

test('a hobkin level is checked against its own model, and a runtime from before says to restart', async () => {
  const { handlers, calls } = hobkins(async () => ({ engine: ENGINE, turn: null }))
  const refused = await runCommand(handlers, 'hobkin.change', { id: 'a1b2c3d4', effort: 'max' })
  assert.equal(refused.ok, false)
  assert.deepEqual(calls, [])
  const { handlers: old } = hobkins()
  assert.deepEqual(await runCommand(old, 'hobkin.change', { id: 'a1b2c3d4', model: 'opus' }), { ok: false, error: { code: 'unavailable', message: 'This hobkin cannot change a hobkin\'s model yet. Restart the app to load it.' } })
})

test("a page shown reaches the runtime with the id, a runtime from before answers yes, and the main hobkin neither lists nor runs it", async () => {
  const { createClientTool } = await import('../src/client-tool.ts')
  const calls: string[] = []
  const handlers = hobkinHandlers({ app: () => ({ hobkins: { pageShown: async (id: string) => (calls.push(id), { ok: true as const }) } }) as never, claudeMissing: async () => null, modelProblem: () => null })
  assert.deepEqual(await runCommand(handlers, 'hobkin.shown', { id: 'a1b2c3d4' }), { ok: true, value: { ok: true } })
  assert.deepEqual(calls, ['a1b2c3d4'])
  const old = hobkinHandlers({ app: () => ({ hobkins: {} }) as never, claudeMissing: async () => null, modelProblem: () => null })
  assert.deepEqual(await runCommand(old, 'hobkin.shown', { id: 'a1b2c3d4' }), { ok: true, value: { ok: true } })
  const none = hobkinHandlers({ app: () => ({}) as never, claudeMissing: async () => null, modelProblem: () => null })
  assert.deepEqual(await runCommand(none, 'hobkin.shown', { id: 'a1b2c3d4' }), { ok: true, value: { ok: true } })
  const tool = createClientTool({ run: (name, args) => runCommand(handlers, name, args) })
  const listed = (await tool.execute('1', { action: 'list' })).details as { name: string }[]
  assert.ok(!listed.some((command) => command.name === 'hobkin.shown'), 'hobkin.shown is not listed for hobkin')
  await assert.rejects(tool.execute('2', { action: 'run', name: 'hobkin.shown', args: { id: 'a1b2c3d4' } }), /cannot run/)
})
