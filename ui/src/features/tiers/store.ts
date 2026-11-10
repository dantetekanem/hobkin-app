import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ModelChoice, TierId, TiersConfig } from '#shared/tiers/tiers.ts'
import { sampleModels, sampleTiers } from './sample.ts'

export type TierTarget = TierId | 'lead'

interface TiersState {
  config: TiersConfig
  models: ModelChoice[]
  open: boolean
  /** The card the lightbox opens on, when it was opened from one tier's label. */
  focus: TierTarget | null

  openTiers: (focus?: TierTarget) => void
  closeTiers: () => void
  applyTiers: (config: TiersConfig) => void
}

/**
 * The tiers and whether their lightbox is open. Sample values until the host supplies hobkin's own. Applied tiers
 * are kept in the app's storage until then (017-model-tiers, S3), so the ones the first-run setup proposes hold.
 */
export const useTiers = create<TiersState>()(
  persist(
    (set) => ({
      config: sampleTiers,
      models: sampleModels,
      open: false,
      focus: null,

      openTiers: (focus) => set({ open: true, focus: focus ?? null }),
      closeTiers: () => set({ open: false }),
      applyTiers: (config) => set({ config, open: false }),
    }),
    { name: 'hobkin-client-tiers', version: 1, partialize: ({ config }) => ({ config }) },
  ),
)
