import { useMemo } from 'react'
import { presetFor, providerChoices, type Preset } from '#shared/tiers/presets.ts'
import type { ModelChoice, TiersConfig } from '#shared/tiers/tiers.ts'
import { useModelChoices } from '@/features/tiers/models.ts'
import { useModels, type ProviderAccess } from '@/lib/host/index.ts'
import { useSetup } from './store.ts'

export interface Proposal {
  /** The connected providers Pi can use a model of now. */
  providers: ProviderAccess[]
  /** The one the proposal comes from: the user's pick, or else the first subscription, or else the first. */
  provider: ProviderAccess | null
  preset: Preset | null
  /** The proposal as the user changed it. Null while no provider is connected. */
  config: TiersConfig | null
  /** Every model Pi can use now, as the tiers name them. */
  choices: ModelChoice[]
}

/** What First settings proposes, from the models Pi can use now. See _specs/025-onboarding. */
export function useProposal(): Proposal {
  const { providers } = useModels()
  const choices = useModelChoices()
  const chosen = useSetup((state) => state.provider)
  const draft = useSetup((state) => state.draft)

  return useMemo(() => {
    const usable = providers.filter((provider) => provider.connected && providerChoices(choices, provider).length > 0)
    const provider =
      usable.find(({ id }) => id === chosen) ??
      usable.find((entry) => entry.signIn?.subscription) ??
      usable[0] ??
      null
    const preset = provider ? presetFor(choices, provider) : null

    // The user's changes hold for the provider they were made on. Another provider starts from its own proposal.
    const changed = provider !== null && draft !== null && draft.provider === provider.id
    const config = changed ? draft.config : (preset?.config ?? null)

    return { providers: usable, provider, preset, config, choices }
  }, [providers, choices, chosen, draft])
}
