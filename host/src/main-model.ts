import type { ModelsState } from '#shared/protocol/models.ts'

/**
 * Why Pi cannot run `provider/id` at this thinking level now, in plain words, or null when it can. The models slice
 * lists exactly the models Pi can use now, so a model missing from it is unknown, or its provider is not connected.
 */
export function whyNotUsable({ providers, models }: ModelsState, model: string, effort?: string): string | null {
  const slash = model.indexOf('/')
  const [providerId, id] = [model.slice(0, slash), model.slice(slash + 1)]
  const choice = models.find((entry) => entry.provider === providerId && entry.id === id)
  if (choice) return effort === undefined || choice.thinking.includes(effort) ? null : `${choice.name} offers these thinking levels: ${choice.thinking.join(', ')}.`

  const provider = providers.find((entry) => entry.id === providerId)
  if (!provider) return `Pi has no provider named ${providerId}.`
  if (!provider.connected) return `${provider.name} is not connected, so Pi cannot use ${id} now. Connect it first.`
  return `Pi knows no ${provider.name} model named ${id}.`
}
