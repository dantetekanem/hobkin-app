import type { ModelsState } from '../protocol/models.ts'
import { EFFORTS, type Effort, type ModelChoice } from './tiers.ts'

/** Pi's thinking level in the tiers' own words, or none for a level the tiers do not know. */
function effortOf(level: string): Effort | null {
  return (EFFORTS as readonly string[]).includes(level) ? (level as Effort) : null
}

/**
 * The models Pi can use now, as the Models window and the first-run setup offer them: named `provider/id`
 * as the tiers store them, under the provider's own name, with the thinking levels the tiers know.
 * See _specs/017-model-tiers.
 */
export function choicesFromPi({ providers, models }: ModelsState): ModelChoice[] {
  const names = new Map(providers.map((provider) => [provider.id, provider.name]))
  return models.map((model) => ({
    // An id can hold a slash of its own (OpenRouter's `moonshotai/kimi-k2.6`), so only one already led by its provider is kept.
    id: model.id.startsWith(`${model.provider}/`) ? model.id : `${model.provider}/${model.id}`,
    name: model.name,
    provider: names.get(model.provider) ?? model.provider,
    efforts: model.thinking.map(effortOf).filter((effort): effort is Effort => effort !== null),
    ...(model.contextWindow ? { context: model.contextWindow } : {}),
  }))
}
