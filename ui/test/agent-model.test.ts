import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ModelChoice } from '#shared/tiers/tiers.ts'
import { agentModelOf, changeFor, changeTarget, effortsOf, modelWords } from '../src/app/agent-model.ts'

const choices: ModelChoice[] = [
  { id: 'openai-codex/gpt-6-astra', name: 'gpt-6-astra', provider: 'OpenAI', efforts: ['medium', 'high', 'xhigh'] },
  { id: 'anthropic/claude-opus-5-5', name: 'Claude Opus 5.5', provider: 'Anthropic', efforts: ['low', 'medium', 'high'] },
  { id: 'claude-code/opus', name: 'opus', provider: 'Claude Code', efforts: ['low', 'high'] },
]
const tierModel = () => ({ model: 'openai-codex/gpt-6-astra', effort: 'xhigh' as const })

test("the pill names the agent's model the way the window names it, never its tier", () => {
  assert.equal(modelWords('anthropic/claude-opus-5-5', choices), 'Claude Opus 5.5')
  // A model Pi does not list now still reads short: its id without the provider.
  assert.equal(modelWords('openrouter/moonshotai/kimi-k2.6', choices), 'moonshotai/kimi-k2.6')
  assert.equal(modelWords('claude-code/opus', choices), 'opus')
  assert.equal(modelWords('claude-code/default', choices), 'claude')
  assert.equal(modelWords(null, choices), null)
})

test("an agent's model is its run's own, then its hobkin's engine, then what its tier runs with", () => {
  const run = { id: 'r1', tier: 'max' as const }
  assert.deepEqual(agentModelOf(run, { model: 'anthropic/claude-opus-5-5', effort: 'high' }, tierModel), { model: 'anthropic/claude-opus-5-5', effort: 'high' })
  // A run that says no model, from an older host, has none: the tier is no stand-in for a running agent.
  assert.deepEqual(agentModelOf(run, {}, tierModel), { model: null, effort: null })
  // With no host, a sample agent shows what its tier runs with.
  assert.deepEqual(agentModelOf(run, undefined, tierModel), { model: 'openai-codex/gpt-6-astra', effort: 'xhigh' })

  const durable = (engine: object, state: 'working' | 'waiting' = 'waiting') => ({ id: 'hobkin:h1', tier: 'mid' as const, durable: { id: 'h1', state, run: state === 'working' ? 't1' : null, engine } as never })
  assert.deepEqual(agentModelOf(durable({ kind: 'pi', model: 'anthropic/claude-opus-5-5', effort: 'low' }), undefined, tierModel), { model: 'anthropic/claude-opus-5-5', effort: 'low' })
  assert.deepEqual(agentModelOf(durable({ kind: 'claude', model: 'opus', effort: 'high' }), undefined, tierModel), { model: 'claude-code/opus', effort: 'high' })
  assert.deepEqual(agentModelOf(durable({ kind: 'claude' }), undefined, tierModel), { model: 'claude-code/default', effort: null })
  // A hobkin on a tier works on its turn's model, and between turns on what the tier runs with now.
  assert.deepEqual(agentModelOf(durable({ kind: 'tier', tier: 'high' }, 'working'), { model: 'anthropic/claude-opus-5-5', effort: 'medium' }, tierModel), { model: 'anthropic/claude-opus-5-5', effort: 'medium' })
  assert.deepEqual(agentModelOf(durable({ kind: 'tier', tier: 'high' }), undefined, tierModel), { model: 'openai-codex/gpt-6-astra', effort: 'xhigh' })
})

test('a working run changes by its run, a durable hobkin by its id, and Claude Code or a waiting run not at all', () => {
  assert.deepEqual(changeTarget({ id: 'r1' }), { target: { agent: 'r1' } })
  assert.deepEqual(changeTarget({ id: 'hobkin:h1', durable: { id: 'h1', engine: { kind: 'tier', tier: 'mid' } } as never }), { target: { hobkin: 'h1' } })
  assert.ok('why' in changeTarget({ id: 'r2', onClaudeCode: true }))
  assert.ok('why' in changeTarget({ id: 'hobkin:h2', durable: { id: 'h2', engine: { kind: 'claude' } } as never }))
  assert.ok('why' in changeTarget({ id: 'r3', waits: { until: '2026-11-25T07:00:00Z' } }))
})

test('a model choice sends the model with the level carried over, or the nearest one it offers', () => {
  const current = { model: 'openai-codex/gpt-6-astra', effort: 'xhigh' as const }
  assert.deepEqual(changeFor(current, choices[1]!), { model: 'anthropic/claude-opus-5-5', effort: 'high' })
  assert.deepEqual(changeFor({ model: 'openai-codex/gpt-6-astra', effort: 'medium' }, choices[1]!), { model: 'anthropic/claude-opus-5-5', effort: 'medium' })
  // With no level known, the model goes alone and the agent keeps its own.
  assert.deepEqual(changeFor({ model: null, effort: null }, choices[1]!), { model: 'anthropic/claude-opus-5-5' })
  // Its own model again asks nothing.
  assert.equal(changeFor(current, choices[0]!), null)
})

test('the levels offered are the current model’s own, and none for a model the window does not know', () => {
  assert.deepEqual(effortsOf('anthropic/claude-opus-5-5', choices), ['low', 'medium', 'high'])
  assert.deepEqual(effortsOf('openrouter/unknown', choices), [])
  assert.deepEqual(effortsOf(null, choices), [])
})
