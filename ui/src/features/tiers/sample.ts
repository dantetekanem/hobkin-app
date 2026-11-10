import type { ModelChoice, TiersConfig } from '#shared/tiers/tiers.ts'

/**
 * Sample models and tiers, so the lightbox can be used before the host supplies the real ones.
 * The host will send the models Pi reports as available and hobkin's saved tiers (017-model-tiers).
 */
export const sampleModels: ModelChoice[] = [
  { id: 'openai-codex/gpt-6-luna', name: 'gpt-6-luna', provider: 'OpenAI', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
  { id: 'openai-codex/gpt-6.1-sol', name: 'gpt-6.1-sol', provider: 'OpenAI', efforts: ['low', 'medium', 'high', 'xhigh'] },
  { id: 'openai-codex/gpt-6-sol', name: 'gpt-6-sol', provider: 'OpenAI', efforts: ['low', 'medium', 'high', 'xhigh'] },
  { id: 'openai-codex/gpt-6-astra', name: 'gpt-6-astra', provider: 'OpenAI', efforts: ['medium', 'high', 'xhigh'] },
  { id: 'anthropic/claude-opus-5-5', name: 'claude-opus-5-5', provider: 'Anthropic', efforts: ['low', 'medium', 'high', 'xhigh'] },
  { id: 'anthropic/claude-sonnet-5-5', name: 'claude-sonnet-5-5', provider: 'Anthropic', efforts: ['low', 'medium', 'high', 'xhigh'] },
  { id: 'anthropic/claude-haiku-5-5', name: 'claude-haiku-5-5', provider: 'Anthropic', efforts: ['minimal', 'low', 'medium'] },
]

export const sampleTiers: TiersConfig = {
  lead: { model: 'openai-codex/gpt-6.1-sol', effort: 'medium' },
  tiers: {
    fast: { model: 'openai-codex/gpt-6-luna', effort: 'low' },
    mid: null,
    high: { model: 'openai-codex/gpt-6-sol', effort: 'high' },
    max: { model: 'openai-codex/gpt-6-astra', effort: 'xhigh' },
  },
}
