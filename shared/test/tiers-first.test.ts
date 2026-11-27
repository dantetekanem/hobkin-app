import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ModelChoice, ModelsState, ProviderAccess } from '../protocol/models.ts'
import { pickFirstModels } from '../tiers/first-models.ts'

// Providers and models as the host's models slice sends them. `defaultModel` is Pi's own default for the provider.
const subscription = { label: 'Sign in', subscription: true }
const CODEX: ProviderAccess = { id: 'openai-codex', name: 'OpenAI Codex', signIn: subscription, connected: true, connectedBy: 'sign-in', defaultModel: 'gpt-6.1-sol' }
const ANTHROPIC: ProviderAccess = { id: 'anthropic', name: 'Anthropic', signIn: subscription, connected: true, connectedBy: 'sign-in', defaultModel: 'claude-opus-4-8' }
const COPILOT: ProviderAccess = { id: 'github-copilot', name: 'GitHub Copilot', signIn: subscription, connected: true, connectedBy: 'sign-in', defaultModel: 'gpt-6.1-sol' }

const ALL = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const model = (provider: string, id: string, name: string, thinking: string[], price?: [number, number]): ModelChoice => ({
  id,
  provider,
  name,
  thinking,
  contextWindow: null,
  ...(price ? { cost: { input: price[0], output: price[1] } } : {}),
})

// Pi's own lists for each subscription, with Pi's prices.
const CODEX_MODELS = [
  model('openai-codex', 'gpt-5.6-luna', 'GPT-5.6 Luna', ALL, [0.2, 1.2]),
  model('openai-codex', 'gpt-6-astra', 'GPT-6 Astra', ALL.slice(1), [10, 50]),
  model('openai-codex', 'gpt-6-luna', 'GPT-6 Luna', ALL, [0.1, 0.5]),
  model('openai-codex', 'gpt-6.1-sol', 'GPT-6.1 Sol', ALL.slice(1), [2, 10]),
  model('openai-codex', 'gpt-6.1-terra', 'GPT-6.1 Terra', ALL, [1, 5]),
]
const ANTHROPIC_MODELS = [
  model('anthropic', 'claude-haiku-4-5', 'Claude Haiku 4.5', ALL.slice(0, 5), [1, 5]),
  model('anthropic', 'claude-haiku-5-5', 'Claude Haiku 5.5', ['off', 'low', 'medium', 'high', 'xhigh', 'max'], [0.1, 0.5]),
  model('anthropic', 'claude-opus-4-8', 'Claude Opus 4.8', ALL, [5, 25]),
]
const COPILOT_MODELS = [
  model('github-copilot', 'claude-haiku-5.5', 'Claude Haiku 5.5', ALL, [0.1, 0.5]),
  model('github-copilot', 'gpt-5.4-nano', 'GPT-5.4 nano', ALL.slice(1, 6), [0.2, 1.25]),
  model('github-copilot', 'gpt-6-luna', 'GPT-6 Luna', ['off', 'low', 'medium', 'high', 'xhigh', 'max'], [0.1, 0.5]),
  model('github-copilot', 'gpt-6.1-sol', 'GPT-6.1 Sol', ['low', 'medium', 'high', 'xhigh', 'max'], [2, 10]),
]

/** A pick as `provider/id level` for hobkin and each tier, so a whole pick reads on a few lines. */
const said = ({ model, effort }: { model: string; effort: string }) => `${model} ${effort}`

function picked(state: ModelsState) {
  const pick = pickFirstModels(state)
  if (!pick) return null

  const { fast, mid, high, max } = pick.tiers
  return {
    provider: pick.provider.id,
    lead: said(pick.lead),
    fast: said(fast),
    mid: said(mid),
    high: said(high),
    max: said(max),
  }
}

test("one subscription: hobkin and its tiers start on Pi's default for it, fast on the cheapest model of its kind, each thinking a little more", () => {
  assert.deepEqual(picked({ providers: [CODEX], models: CODEX_MODELS }), {
    provider: 'openai-codex',
    lead: 'openai-codex/gpt-6.1-sol medium',
    fast: 'openai-codex/gpt-6-luna low',
    mid: 'openai-codex/gpt-6.1-sol medium',
    high: 'openai-codex/gpt-6.1-sol high',
    max: 'openai-codex/gpt-6.1-sol max',
  })
  assert.deepEqual(picked({ providers: [ANTHROPIC], models: ANTHROPIC_MODELS }), {
    provider: 'anthropic',
    lead: 'anthropic/claude-opus-4-8 medium',
    fast: 'anthropic/claude-haiku-5-5 low',
    mid: 'anthropic/claude-opus-4-8 medium',
    high: 'anthropic/claude-opus-4-8 high',
    max: 'anthropic/claude-opus-4-8 max',
  })
  // Claude Haiku is as cheap, but it is not the default's kind. GPT-5.4 nano is cheaper than the default, but stops at xhigh.
  assert.deepEqual(picked({ providers: [COPILOT], models: COPILOT_MODELS }), {
    provider: 'github-copilot',
    lead: 'github-copilot/gpt-6.1-sol medium',
    fast: 'github-copilot/gpt-6-luna low',
    mid: 'github-copilot/gpt-6.1-sol medium',
    high: 'github-copilot/gpt-6.1-sol high',
    max: 'github-copilot/gpt-6.1-sol max',
  })
})

test('each pick carries the name Pi gives the model and the provider', () => {
  const pick = pickFirstModels({ providers: [CODEX], models: CODEX_MODELS })
  assert.deepEqual(pick?.provider, { id: 'openai-codex', name: 'OpenAI Codex' })
  assert.deepEqual(pick?.lead, { model: 'openai-codex/gpt-6.1-sol', name: 'GPT-6.1 Sol', effort: 'medium' })
  assert.deepEqual(pick?.tiers.fast, { model: 'openai-codex/gpt-6-luna', name: 'GPT-6 Luna', effort: 'low' })
})

test('a thinking level a model lacks moves to the nearest it has, and max takes the most it allows', () => {
  const narrow = picked({
    providers: [{ ...ANTHROPIC, defaultModel: 'gemini-pro' }],
    models: [model('anthropic', 'gemini-pro', 'Narrow', ['medium', 'high'])],
  })
  assert.deepEqual(narrow, {
    provider: 'anthropic',
    lead: 'anthropic/gemini-pro medium',
    fast: 'anthropic/gemini-pro medium',
    mid: 'anthropic/gemini-pro medium',
    high: 'anthropic/gemini-pro high',
    max: 'anthropic/gemini-pro high',
  })
})

test('fast stays on the default when nothing cheaper of its kind thinks as hard, or when Pi knows no prices', () => {
  // Cheaper, but stops at high while the default reaches max.
  const olderOnly = [model('anthropic', 'claude-haiku-4-5', 'Claude Haiku 4.5', ALL.slice(0, 5), [1, 5]), model('anthropic', 'claude-opus-4-8', 'Claude Opus 4.8', ALL, [5, 25])]
  assert.equal(picked({ providers: [ANTHROPIC], models: olderOnly })?.fast, 'anthropic/claude-opus-4-8 low')
  // Cheaper, but cannot think at all.
  const plainCheap = [model('anthropic', 'claude-plain', 'Plain', ['off'], [0.1, 0.1]), model('anthropic', 'claude-opus-4-8', 'Claude Opus 4.8', ALL, [5, 25])]
  assert.equal(picked({ providers: [ANTHROPIC], models: plainCheap })?.fast, 'anthropic/claude-opus-4-8 low')
  // No prices at all, as from a launcher or a local model.
  const unpriced = CODEX_MODELS.map(({ id, provider, name, thinking, contextWindow }) => ({ id, provider, name, thinking, contextWindow }))
  assert.equal(picked({ providers: [CODEX], models: unpriced })?.fast, 'openai-codex/gpt-6.1-sol low')
  // A price for the cheap one, but none for the default: nothing to compare with.
  const defaultUnpriced = CODEX_MODELS.map((entry) => (entry.id === 'gpt-6.1-sol' ? { ...entry, cost: undefined } : entry))
  assert.equal(picked({ providers: [CODEX], models: defaultUnpriced })?.fast, 'openai-codex/gpt-6.1-sol low')
})

test('several accounts: a subscription sign-in before a key, then the written order, then Pi\'s order', () => {
  const byKey = (provider: ProviderAccess): ProviderAccess => ({ ...provider, connectedBy: 'key' })
  const models = [...ANTHROPIC_MODELS, ...COPILOT_MODELS, ...CODEX_MODELS]

  assert.equal(picked({ providers: [ANTHROPIC, COPILOT, CODEX], models })?.provider, 'openai-codex', 'all three by sign-in: the written order')
  assert.equal(picked({ providers: [ANTHROPIC, COPILOT], models })?.provider, 'anthropic')
  assert.equal(picked({ providers: [byKey(ANTHROPIC), COPILOT], models })?.provider, 'github-copilot', 'a sign-in comes before a key')
  assert.equal(picked({ providers: [byKey(ANTHROPIC), byKey(CODEX)], models })?.provider, 'openai-codex', 'two keys: the written order')

  // Providers the written order does not name come after those it names, in Pi's order.
  const groq: ProviderAccess = { id: 'groq', name: 'Groq', connected: true, connectedBy: 'environment', defaultModel: 'gpt-oss' }
  const mistral: ProviderAccess = { id: 'mistral', name: 'Mistral', connected: true, connectedBy: 'environment' }
  const others = [model('mistral', 'devstral', 'Devstral', ALL), model('groq', 'gpt-oss', 'GPT OSS', ALL)]
  assert.equal(picked({ providers: [mistral, groq], models: others })?.provider, 'mistral')
  assert.equal(picked({ providers: [mistral, groq, byKey(ANTHROPIC)], models: [...others, ...ANTHROPIC_MODELS] })?.provider, 'anthropic')
  // A work computer's launcher is as good as a subscription: the company pays for it.
  const launcher: ProviderAccess = { id: 'company', name: 'Company', connected: true, connectedBy: 'launcher' }
  assert.equal(picked({ providers: [byKey(ANTHROPIC), launcher], models: [...ANTHROPIC_MODELS, model('company', 'big', 'Big', ALL)] })?.provider, 'company')
})

test('only a connected provider Pi lists a model for counts', () => {
  const offline = { ...CODEX, connected: false }
  assert.equal(picked({ providers: [offline, ANTHROPIC], models: [...CODEX_MODELS, ...ANTHROPIC_MODELS] })?.provider, 'anthropic')
  assert.equal(picked({ providers: [CODEX, ANTHROPIC], models: ANTHROPIC_MODELS })?.provider, 'anthropic', 'connected, but Pi lists none of its models')
  assert.equal(pickFirstModels({ providers: [offline], models: CODEX_MODELS }), null)
  assert.equal(pickFirstModels({ providers: [], models: [] }), null)
})

test("with no default Pi can use, the first model Pi lists that thinks", () => {
  const listed = [model('openai-codex', 'gpt-4o', 'GPT-4o', ['off'], [2.5, 10]), ...CODEX_MODELS]
  assert.equal(picked({ providers: [{ ...CODEX, defaultModel: undefined }], models: listed })?.lead, 'openai-codex/gpt-5.6-luna medium')
  assert.equal(picked({ providers: [{ ...CODEX, defaultModel: 'gpt-9-gone' }], models: listed })?.lead, 'openai-codex/gpt-5.6-luna medium')
})

test('a default whose id holds a slash is found as Pi names it', () => {
  const openrouter: ProviderAccess = { id: 'openrouter', name: 'OpenRouter', connected: true, connectedBy: 'key', defaultModel: 'moonshotai/kimi-k2.6' }
  const routed = [model('openrouter', 'z-ai/glm-5', 'GLM 5', ['low', 'medium', 'high']), model('openrouter', 'moonshotai/kimi-k2.6', 'Kimi K2.6', ['low', 'medium', 'high'])]
  assert.equal(picked({ providers: [openrouter], models: routed })?.lead, 'openrouter/moonshotai/kimi-k2.6 medium')
})

test('a provider whose models cannot think gets its first model on every tier, thinking off', () => {
  const groq: ProviderAccess = { id: 'groq', name: 'Groq', connected: true, connectedBy: 'environment' }
  assert.deepEqual(picked({ providers: [groq], models: [model('groq', 'llama-4', 'Llama 4', ['off'])] }), {
    provider: 'groq',
    lead: 'groq/llama-4 off',
    fast: 'groq/llama-4 off',
    mid: 'groq/llama-4 off',
    high: 'groq/llama-4 off',
    max: 'groq/llama-4 off',
  })
})
