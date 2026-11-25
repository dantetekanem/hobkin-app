import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HobkinEngine } from '#shared/protocol/hobkins.ts'
import type { ModelChoice } from '#shared/tiers/tiers.ts'
import { agentModelOf, changeFor, changeTarget, effortsOf, modelWords } from '../src/app/agent-model.ts'
import type { DurableMark } from '../src/features/hobkins/list.ts'

const astra: ModelChoice = { id: 'openai-codex/gpt-6-astra', name: 'gpt-6-astra', provider: 'OpenAI', efforts: ['medium', 'high', 'xhigh'] }
const opus: ModelChoice = { id: 'anthropic/claude-opus-5-5', name: 'Claude Opus 5.5', provider: 'Anthropic', efforts: ['low', 'medium', 'high'] }
const claudeCodeOpus: ModelChoice = { id: 'claude-code/opus', name: 'opus', provider: 'Claude Code', efforts: ['low', 'high'] }
const choices = [astra, opus, claudeCodeOpus]

/** What every tier runs with in these tests. */
const tierModel = () => ({ model: astra.id, effort: 'xhigh' as const })

/** A durable hobkin on `engine`, between turns, or working on its turn `t1`. */
function hobkin(engine: HobkinEngine, state: DurableMark['state'] = 'waiting') {
  const durable: DurableMark = { id: 'h1', state, run: state === 'working' ? 't1' : null, unseen: false, engine, cwd: '/projects/h1' }
  return { id: 'hobkin:h1', tier: 'mid' as const, durable }
}

test("the pill names the agent's model the way the window names it, never its tier", () => {
  assert.equal(modelWords(opus.id, choices), 'Claude Opus 5.5')
  // A model Pi does not list now still reads short: its id without the provider.
  assert.equal(modelWords('openrouter/moonshotai/kimi-k2.6', choices), 'moonshotai/kimi-k2.6')
  assert.equal(modelWords('claude-code/opus', choices), 'opus')
  assert.equal(modelWords('claude-code/default', choices), 'claude')
  assert.equal(modelWords(null, choices), null)
})

test("a run works on its own model, and on none when the host names none", () => {
  const run = { id: 'r1', tier: 'max' as const }

  assert.deepEqual(agentModelOf(run, { model: opus.id, effort: 'high' }, tierModel), { model: opus.id, effort: 'high' })
  // A run from an older host names no model: the tier is no stand-in for a running agent.
  assert.deepEqual(agentModelOf(run, {}, tierModel), { model: null, effort: null })
  // With no host, a sample agent shows what its tier runs with.
  assert.deepEqual(agentModelOf(run, undefined, tierModel), { model: astra.id, effort: 'xhigh' })
})

test("a durable hobkin works on its engine's model, and on a tier its turn's or the tier's", () => {
  assert.deepEqual(agentModelOf(hobkin({ kind: 'pi', model: opus.id, effort: 'low' }), undefined, tierModel), { model: opus.id, effort: 'low' })
  assert.deepEqual(agentModelOf(hobkin({ kind: 'claude', model: 'opus', effort: 'high' }), undefined, tierModel), { model: 'claude-code/opus', effort: 'high' })
  assert.deepEqual(agentModelOf(hobkin({ kind: 'claude' }), undefined, tierModel), { model: 'claude-code/default', effort: null })

  const onTier = { kind: 'tier', tier: 'high' } as const
  const turn = { model: opus.id, effort: 'medium' }
  assert.deepEqual(agentModelOf(hobkin(onTier, 'working'), turn, tierModel), { model: opus.id, effort: 'medium' })
  assert.deepEqual(agentModelOf(hobkin(onTier), undefined, tierModel), { model: astra.id, effort: 'xhigh' })
})

test('a working run changes by its run, a durable hobkin by its id, and Claude Code or a waiting run not at all', () => {
  assert.deepEqual(changeTarget({ id: 'r1' }), { target: { agent: 'r1' } })
  assert.deepEqual(changeTarget(hobkin({ kind: 'tier', tier: 'mid' })), { target: { hobkin: 'h1' } })

  assert.ok('why' in changeTarget({ id: 'r2', onClaudeCode: true }))
  assert.ok('why' in changeTarget(hobkin({ kind: 'claude' })))
  assert.ok('why' in changeTarget({ id: 'r3', waits: { until: '2026-11-25T07:00:00Z' } }))
})

test('a model choice sends the model with the level carried over, or the nearest one it offers', () => {
  const onAstra = { model: astra.id, effort: 'xhigh' as const }

  assert.deepEqual(changeFor(onAstra, opus), { model: opus.id, effort: 'high' })
  assert.deepEqual(changeFor({ ...onAstra, effort: 'medium' }, opus), { model: opus.id, effort: 'medium' })
  // With no level known, the model goes alone and the agent keeps its own.
  assert.deepEqual(changeFor({ model: null, effort: null }, opus), { model: opus.id })
  // Its own model again asks nothing.
  assert.equal(changeFor(onAstra, astra), null)
})

test('the levels offered are the current model’s own, and none for a model the window does not know', () => {
  assert.deepEqual(effortsOf(opus.id, choices), ['low', 'medium', 'high'])
  assert.deepEqual(effortsOf('openrouter/unknown', choices), [])
  assert.deepEqual(effortsOf(null, choices), [])
})
