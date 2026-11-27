import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { ModelsState } from '#shared/protocol/models.ts'
import type { HostTiers, TiersChange } from '#shared/tiers/tiers.ts'
import { neverChosen, setFirstModels } from '../src/first-models.ts'
import { applyHostTiers, readHostTiers } from '../src/tiers.ts'
import { temporaryDirectory } from './support.ts'

// What hobkin's config holds on a new home: nothing named for the chat, the checks or a tier.
const NEW_HOME: HostTiers = {
  lead: { model: null, effort: 'medium' },
  tiers: {
    fast: { model: null, effort: 'medium', follows: 'background' },
    mid: { model: null, effort: 'medium', follows: 'main' },
    high: { model: null, effort: 'medium', follows: 'main' },
    max: { model: null, effort: 'medium', follows: 'main' },
  },
  review: { reviewer: 'high', quick: 'fast' },
}

const ALL = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const CODEX: ModelsState = {
  providers: [{ id: 'openai-codex', name: 'OpenAI Codex', signIn: { label: 'Sign in', subscription: true }, connected: true, connectedBy: 'sign-in', defaultModel: 'gpt-6.1-sol' }],
  models: [
    { id: 'gpt-6-luna', provider: 'openai-codex', name: 'GPT-6 Luna', thinking: ALL, contextWindow: null, cost: { input: 0.1, output: 0.5 } },
    { id: 'gpt-6.1-sol', provider: 'openai-codex', name: 'GPT-6.1 Sol', thinking: ALL.slice(1), contextWindow: null, cost: { input: 2, output: 10 } },
  ],
}

/** The host as `setFirstModels` sees it, keeping what it was asked to save. */
function fakeHost(tiers: HostTiers, models: ModelsState = CODEX) {
  const calls: string[] = []
  const saved: { main?: [string, string]; checks?: [string, string]; tiers?: TiersChange } = {}
  return {
    calls,
    saved,
    deps: {
      models: async () => {
        calls.push('models')
        return models
      },
      tiers: async () => tiers,
      selectModel: async (model: string, effort: string) => {
        calls.push('main')
        saved.main = [model, effort]
      },
      selectChecks: async (model: string, effort: string) => {
        calls.push('checks')
        saved.checks = [model, effort]
      },
      applyTiers: async (change: TiersChange) => {
        calls.push('tiers')
        saved.tiers = change
      },
    },
  }
}

test("a new home gets hobkin's model, the checks' and every tier from the account, the chat's first, and hears what was set", async () => {
  const host = fakeHost(NEW_HOME)
  const answer = await setFirstModels(host.deps)

  assert.deepEqual(host.calls, ['models', 'main', 'checks', 'tiers'])
  assert.deepEqual(host.saved.main, ['openai-codex/gpt-6.1-sol', 'medium'])
  assert.deepEqual(host.saved.checks, ['openai-codex/gpt-6.1-sol', 'medium'], 'the mid pick')
  assert.deepEqual(host.saved.tiers, {
    tiers: {
      fast: { model: 'openai-codex/gpt-6-luna', effort: 'low' },
      mid: { model: 'openai-codex/gpt-6.1-sol', effort: 'medium' },
      high: { model: 'openai-codex/gpt-6.1-sol', effort: 'high' },
      max: { model: 'openai-codex/gpt-6.1-sol', effort: 'max' },
    },
  })
  assert.ok(answer.set)
  assert.deepEqual(answer.provider, { id: 'openai-codex', name: 'OpenAI Codex' })
  assert.deepEqual(answer.lead, { model: 'openai-codex/gpt-6.1-sol', name: 'GPT-6.1 Sol', effort: 'medium' })
  assert.equal(answer.tiers.fast.name, 'GPT-6 Luna')
})

test('a model chosen before, for the chat, the checks or any tier, is never overwritten', async () => {
  const chat = { ...NEW_HOME, lead: { model: 'anthropic/claude-opus-5-5', effort: 'high' as const } }
  const checks = { ...NEW_HOME, tiers: { ...NEW_HOME.tiers, fast: { model: 'anthropic/claude-haiku-5-5', effort: 'low' as const, follows: 'background' as const } } }
  const tier = { ...NEW_HOME, tiers: { ...NEW_HOME.tiers, max: { model: 'anthropic/claude-fable-5', effort: 'max' as const, follows: null } } }

  for (const chosen of [chat, checks, tier]) {
    const host = fakeHost(chosen)
    assert.deepEqual(await setFirstModels(host.deps), { set: false, why: 'chosen' })
    assert.deepEqual(host.calls, [], 'nothing is read of Pi or saved')
  }
})

test('with no account Pi can use, nothing is set', async () => {
  const host = fakeHost(NEW_HOME, { providers: [{ ...CODEX.providers[0]!, connected: false }], models: [] })
  assert.deepEqual(await setFirstModels(host.deps), { set: false, why: 'no-model' })
  assert.deepEqual(host.calls, ['models'])
})

test("hobkin's own config tells a new home from one where a model was chosen", async (t) => {
  const root = temporaryDirectory(t)
  const { initialize } = await import('hobkin/src/cli/config.mjs')
  initialize(root, { cwd: root })
  assert.equal(neverChosen(await readHostTiers(root)), true, 'as hobkin makes a home')

  // A tier given a model of its own.
  const catalog = { getModel: (provider: string, id: string) => (provider === 'fake' && id === 'strong' ? { provider, id, reasoning: true } : undefined) }
  await applyHostTiers(root, { tiers: { high: { model: 'fake/strong', effort: 'high' } } }, catalog)
  assert.equal(neverChosen(await readHostTiers(root)), false)
  await applyHostTiers(root, { tiers: { high: null } }, catalog)
  assert.equal(neverChosen(await readHostTiers(root)), true, 'following again names nothing')

  // The chat's model, or the checks', as hobkin's own settings save them.
  const file = join(root, 'config.json')
  const config = JSON.parse(readFileSync(file, 'utf8'))
  writeFileSync(file, JSON.stringify({ ...config, main: { ...config.main, model: 'fake/chat' } }))
  assert.equal(neverChosen(await readHostTiers(root)), false)
  writeFileSync(file, JSON.stringify({ ...config, background: { ...config.background, model: 'fake/checks' } }))
  assert.equal(neverChosen(await readHostTiers(root)), false)
})
