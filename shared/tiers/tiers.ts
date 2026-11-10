/**
 * Model tiers for delegated work. hobkin names a tier when it starts an agent, never a model.
 * A tier is a model plus a thinking level. See _specs/017-model-tiers.
 *
 * Pure rules only, shared by the host and the UI.
 */

export const TIER_IDS = ['fast', 'mid', 'high', 'max'] as const
export type TierId = (typeof TIER_IDS)[number]

/**
 * Thinking levels, weakest first: Pi's own, which are also the ones hobkin accepts for its main model
 * (MAIN_EFFORTS in shared/commands/registry.ts). The order is what "nearest" means when a level has to move.
 */
export const EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
export type Effort = (typeof EFFORTS)[number]

export interface TierSetting {
  /** Pi's `provider/id`. */
  model: string
  effort: Effort
}

export interface TiersConfig {
  /** The main chat. It is the lead, not a tier. */
  lead: TierSetting
  /** A tier that is null follows the lead. */
  tiers: Record<TierId, TierSetting | null>
}

export interface ModelChoice {
  id: string
  name: string
  provider: string
  /** The thinking levels this model supports. */
  efforts: readonly Effort[]
  /** Context size in tokens, when the provider reports one. */
  context?: number
}

export const TIER_INFO: Record<TierId, { label: string; meantFor: string }> = {
  fast: { label: 'Fast', meantFor: 'Collecting, searching, small mechanical edits' },
  mid: { label: 'Mid', meantFor: 'Ordinary features, reviews and checks' },
  high: { label: 'High', meantFor: 'Work that spans a system or needs careful analysis' },
  max: { label: 'Max', meantFor: 'Rare, high-risk work: security, data, recovery' },
}

/** What a tier runs with right now. An unset tier runs with the lead's model and effort. */
export function resolveTier(config: TiersConfig, tier: TierId): TierSetting & { followsLead: boolean } {
  const own = config.tiers[tier]
  return own ? { ...own, followsLead: false } : { ...config.lead, followsLead: true }
}

/** The effort to use on a model: the one asked for, or the nearest one the model supports. A tie goes to the lower effort. */
export function clampEffort(model: ModelChoice, effort: Effort): Effort {
  if (model.efforts.includes(effort)) return effort
  const wanted = EFFORTS.indexOf(effort)
  let nearest = model.efforts[0] ?? effort
  for (const candidate of model.efforts) {
    const distance = Math.abs(EFFORTS.indexOf(candidate) - wanted)
    const best = Math.abs(EFFORTS.indexOf(nearest) - wanted)
    if (distance < best || (distance === best && EFFORTS.indexOf(candidate) < EFFORTS.indexOf(nearest))) nearest = candidate
  }
  return nearest
}

/**
 * Sets the model of the lead or of one tier. The effort is kept when the model supports it, and moved to
 * the nearest supported one otherwise. `effortMovedFrom` names the old effort when it had to move.
 */
export function setTierModel(config: TiersConfig, target: TierId | 'lead', model: ModelChoice): { config: TiersConfig; effortMovedFrom: Effort | null } {
  const current = target === 'lead' ? config.lead : resolveTier(config, target)
  const effort = clampEffort(model, current.effort)
  const setting: TierSetting = { model: model.id, effort }
  return {
    config: target === 'lead' ? { ...config, lead: setting } : { ...config, tiers: { ...config.tiers, [target]: setting } },
    effortMovedFrom: effort === current.effort ? null : current.effort,
  }
}

/** Models whose name or provider contains every word of the search, ignoring case. */
export function filterModels(models: readonly ModelChoice[], search: string): ModelChoice[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  return models.filter((model) => {
    const text = `${model.provider} ${model.name} ${model.id}`.toLowerCase()
    return words.every((word) => text.includes(word))
  })
}
