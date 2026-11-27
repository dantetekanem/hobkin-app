/**
 * hobkin's first model and tiers (`017-model-tiers`, "The first models"): set once, when the first-run setup finds or
 * signs in to an account, from the models Pi can use now, and only on a home where no model was ever chosen. The
 * setup's story says what was set.
 */
import type { ModelsState } from '#shared/protocol/models.ts'
import { pickFirstModels, type FirstModels, type Picked } from '#shared/tiers/first-models.ts'
import { TIER_IDS, type Effort, type HostTiers, type TierSetting, type TiersChange } from '#shared/tiers/tiers.ts'

export interface FirstModelsHost {
  /** The models Pi can use now, asked again. */
  models: () => Promise<ModelsState>
  /** hobkin's model and tiers as its config.json holds them. */
  tiers: () => Promise<HostTiers>
  /** Saves hobkin's own model, as `models.select` does. */
  selectModel: (model: string, effort: Effort) => Promise<unknown>
  /** Saves tiers, as `tiers.apply` does. */
  applyTiers: (change: TiersChange) => Promise<unknown>
}

/**
 * No model was ever chosen: the chat, the checks and every tier still run on whatever Pi starts with, as hobkin writes
 * a new home. hobkin's settings, its Models window and its terminal name a model when they save one and never clear
 * the chat's, so this holds until something chooses, this setup included.
 */
export function neverChosen({ lead, tiers }: HostTiers): boolean {
  return lead.model === null && TIER_IDS.every((tier) => tiers[tier].follows !== null && tiers[tier].model === null)
}

/** What a tier saves of a pick: its model and level, without the name. */
const settingOf = ({ model, effort }: Picked): TierSetting => ({ model, effort })

export async function setFirstModels({ models, tiers, selectModel, applyTiers }: FirstModelsHost): Promise<FirstModels> {
  if (!neverChosen(await tiers())) return { set: false, why: 'chosen' }

  const pick = pickFirstModels(await models())
  if (!pick) return { set: false, why: 'no-model' }

  // The chat's model first. Should the tiers then fail, they follow it, and the home reads as chosen from then on.
  await selectModel(pick.lead.model, pick.lead.effort)
  const { fast, mid, high, max } = pick.tiers
  await applyTiers({ tiers: { fast: settingOf(fast), mid: settingOf(mid), high: settingOf(high), max: settingOf(max) } })

  return { set: true, ...pick }
}
