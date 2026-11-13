import assert from 'node:assert/strict'
import { test } from 'node:test'
import { choicesFromPi } from '../tiers/from-pi.ts'

const providers = [
  { id: 'openai-codex', name: 'ChatGPT', signIn: { label: 'Sign in with ChatGPT', subscription: true }, connected: true },
  { id: 'anthropic', name: 'Anthropic', apiKey: { label: 'Anthropic API key', env: ['ANTHROPIC_API_KEY'] }, connected: true },
]

test('the models Pi can use become choices named provider/id, under the provider\'s own name', () => {
  const choices = choicesFromPi({
    providers,
    models: [
      { id: 'gpt-6.1-sol', provider: 'openai-codex', name: 'GPT-6.1 Sol', thinking: ['low', 'medium', 'high', 'xhigh'], contextWindow: 400_000 },
      { id: 'claude-haiku-5-5', provider: 'anthropic', name: 'Claude Haiku 5.5', thinking: ['minimal', 'low', 'medium'], contextWindow: null },
    ],
  })

  assert.deepEqual(choices, [
    { id: 'openai-codex/gpt-6.1-sol', name: 'GPT-6.1 Sol', provider: 'ChatGPT', efforts: ['low', 'medium', 'high', 'xhigh'], context: 400_000 },
    { id: 'anthropic/claude-haiku-5-5', name: 'Claude Haiku 5.5', provider: 'Anthropic', efforts: ['minimal', 'low', 'medium'] },
  ])
})

test('Pi\'s off is a level, levels the tiers do not know are left out, and a model without thinking has none', () => {
  const [choice] = choicesFromPi({ providers, models: [{ id: 'm', provider: 'anthropic', name: 'M', thinking: ['off', 'low', 'turbo'], contextWindow: null }] })
  assert.deepEqual(choice!.efforts, ['off', 'low'])

  const [plain] = choicesFromPi({ providers, models: [{ id: 'p', provider: 'anthropic', name: 'P', thinking: [], contextWindow: null }] })
  assert.deepEqual(plain!.efforts, [])
})

test('every level Pi lists for a model is kept in Pi\'s order, max included', () => {
  const [choice] = choicesFromPi({ providers, models: [{ id: 'qwen3.6', provider: 'ollama', name: 'qwen3.6', thinking: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], contextWindow: null }] })
  assert.deepEqual(choice!.efforts, ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
})

test('an id that already starts with its provider is kept, and an unknown provider keeps its id as its name', () => {
  const [choice] = choicesFromPi({ providers, models: [{ id: 'ollama/qwen', provider: 'ollama', name: 'qwen', thinking: [], contextWindow: null }] })
  assert.equal(choice!.id, 'ollama/qwen')
  assert.equal(choice!.provider, 'ollama')
})

test('a model id with a slash of its own still gets its provider in front', () => {
  const [choice] = choicesFromPi({ providers, models: [{ id: 'moonshotai/kimi-k2.6', provider: 'openrouter', name: 'Kimi K2.6', thinking: [], contextWindow: null }] })
  assert.equal(choice!.id, 'openrouter/moonshotai/kimi-k2.6')
})
