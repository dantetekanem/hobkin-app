import assert from 'node:assert/strict'
import { test } from 'node:test'
import { presetFor, providerChoices } from '../tiers/presets.ts'
import type { ModelChoice } from '../tiers/tiers.ts'

// Providers as the models slice sends them: `defaultModel` is Pi's own default, there only when Pi's catalog has it.
const OPENAI = { id: 'openai', name: 'OpenAI', defaultModel: 'gpt-6.1-sol' }
const ANTHROPIC = { id: 'anthropic', name: 'Anthropic', defaultModel: 'claude-opus-4-8' }
const GOOGLE = { id: 'google', name: 'Google', defaultModel: 'gemini-3.1-pro-preview' }
const LOW_TO_XHIGH = ['low', 'medium', 'high', 'xhigh'] as const

// Pi's own models, in the order Pi lists them, as `choicesFromPi` hands them over.
const CHOICES: ModelChoice[] = [
  { id: 'openai/chat-latest', name: 'Chat Latest', provider: 'OpenAI', efforts: ['off', 'minimal', 'low', 'medium', 'high'] },
  { id: 'openai/gpt-6-luna', name: 'GPT-6 Luna', provider: 'OpenAI', efforts: ['off', ...LOW_TO_XHIGH] },
  { id: 'openai/gpt-6.1-sol', name: 'GPT-6.1 Sol', provider: 'OpenAI', efforts: [...LOW_TO_XHIGH], context: 272_000 },
  { id: 'anthropic/claude-haiku-5-5', name: 'Claude Haiku 5.5', provider: 'Anthropic', efforts: ['off', ...LOW_TO_XHIGH] },
  { id: 'anthropic/claude-opus-4-8', name: 'Claude Opus 4.8', provider: 'Anthropic', efforts: ['off', 'minimal', ...LOW_TO_XHIGH] },
]

test('the tiers start on Pi\'s default model for the provider, each thinking a little more', () => {
  const preset = presetFor(CHOICES, OPENAI)

  assert.equal(preset?.source, 'pi')
  assert.equal(preset?.model.id, 'openai/gpt-6.1-sol')
  assert.deepEqual(preset?.config, {
    lead: { model: 'openai/gpt-6.1-sol', effort: 'medium' },
    tiers: {
      fast: { model: 'openai/gpt-6.1-sol', effort: 'low' },
      mid: { model: 'openai/gpt-6.1-sol', effort: 'medium' },
      high: { model: 'openai/gpt-6.1-sol', effort: 'high' },
      max: { model: 'openai/gpt-6.1-sol', effort: 'xhigh' },
    },
  })
})

test('the default is the one Pi sends with the provider', () => {
  const anotherDefault = presetFor(CHOICES, { ...OPENAI, defaultModel: 'gpt-6-luna' })
  const anthropic = presetFor(CHOICES, ANTHROPIC)

  assert.equal(anotherDefault?.model.id, 'openai/gpt-6-luna')
  assert.equal(anthropic?.model.id, 'anthropic/claude-opus-4-8')
})

test('each tier\'s thinking is moved to what the model allows, and max takes the most it allows', () => {
  const mediumToHigh: ModelChoice[] = [
    { id: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', provider: 'Google', efforts: ['medium', 'high'] },
  ]
  const minimalToHigh: ModelChoice[] = [
    { id: 'openai/gpt-5-mini', name: 'GPT-5 Mini', provider: 'OpenAI', efforts: ['minimal', 'low', 'medium', 'high'] },
  ]

  const narrow = presetFor(mediumToHigh, GOOGLE)
  const mini = presetFor(minimalToHigh, { ...OPENAI, defaultModel: 'gpt-5-mini' })

  assert.ok(narrow)
  assert.equal(narrow.config.tiers.fast?.effort, 'medium', 'low is not offered, so the nearest level')
  assert.equal(narrow.config.lead.effort, 'medium')
  assert.equal(narrow.config.tiers.high?.effort, 'high')
  assert.equal(narrow.config.tiers.max?.effort, 'high', 'nothing above high')
  assert.equal(mini?.config.tiers.max?.effort, 'high')
})

test('a model that thinks at max gives the max tier max, and the others their usual levels', () => {
  const deepest: ModelChoice[] = [
    { id: 'anthropic/claude-opus-5-5', name: 'Claude Opus 5.5', provider: 'Anthropic', efforts: ['off', ...LOW_TO_XHIGH, 'max'] },
  ]

  const preset = presetFor(deepest, { ...ANTHROPIC, defaultModel: 'claude-opus-5-5' })

  assert.equal(preset?.config.tiers.max?.effort, 'max')
  assert.equal(preset?.config.tiers.high?.effort, 'high')
  assert.equal(preset?.config.lead.effort, 'medium')
})

test('with no default for the provider, or one Pi cannot use now, the first model Pi lists that thinks', () => {
  const listed: ModelChoice[] = [
    { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'OpenAI', efforts: ['off'] },
    ...CHOICES,
  ]

  const noDefault = presetFor(listed, { id: 'openai', name: 'OpenAI' })
  const goneDefault = presetFor(listed, { ...OPENAI, defaultModel: 'gpt-9-gone' })

  assert.equal(noDefault?.source, 'first')
  assert.equal(noDefault?.model.id, 'openai/chat-latest', 'GPT-4o cannot think, so it is passed over')
  assert.equal(goneDefault?.source, 'first')
  assert.equal(goneDefault?.model.id, 'openai/chat-latest')
})

test('only the provider\'s own models count', () => {
  const anthropicIds = providerChoices(CHOICES, ANTHROPIC).map((choice) => choice.id)
  // Another provider's model of that id is not the default here.
  const otherProvidersDefault = presetFor(CHOICES, { ...ANTHROPIC, defaultModel: 'gpt-6.1-sol' })

  assert.deepEqual(anthropicIds, ['anthropic/claude-haiku-5-5', 'anthropic/claude-opus-4-8'])
  assert.equal(otherProvidersDefault?.model.id, 'anthropic/claude-haiku-5-5')
})

test('a default whose id holds a slash is found as Pi names it', () => {
  const routed: ModelChoice[] = [
    { id: 'openrouter/z-ai/glm-5', name: 'Z.ai: GLM 5', provider: 'OpenRouter', efforts: ['low', 'medium', 'high'] },
    { id: 'openrouter/moonshotai/kimi-k2.6', name: 'MoonshotAI: Kimi K2.6', provider: 'OpenRouter', efforts: ['low', 'medium', 'high'] },
  ]

  const preset = presetFor(routed, { id: 'openrouter', name: 'OpenRouter', defaultModel: 'moonshotai/kimi-k2.6' })

  assert.equal(preset?.model.id, 'openrouter/moonshotai/kimi-k2.6')
})

test('a provider Pi can use no model of has no preset', () => {
  assert.equal(presetFor(CHOICES, GOOGLE), null)
  assert.equal(presetFor([], OPENAI), null)
})

test('a provider whose models cannot think gets its first model on every tier, thinking off', () => {
  const plain: ModelChoice[] = [{ id: 'groq/llama-4', name: 'Llama 4', provider: 'Groq', efforts: ['off'] }]

  const preset = presetFor(plain, { id: 'groq', name: 'Groq' })

  assert.equal(preset?.model.id, 'groq/llama-4')
  assert.deepEqual(preset?.config.lead, { model: 'groq/llama-4', effort: 'off' })
  assert.deepEqual(preset?.config.tiers.max, { model: 'groq/llama-4', effort: 'off' })
})
