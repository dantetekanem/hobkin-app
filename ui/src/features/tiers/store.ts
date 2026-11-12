import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_REVIEW_TIERS, type HostTiers, type ModelChoice, type ReviewTiers, type TierId, type TiersConfig } from '#shared/tiers/tiers.ts'
import { LEAD_FOLLOWS, fromHost, migrateSavedTiers, type TiersView } from './host-tiers.ts'
import { sampleModels, sampleTiers } from './sample.ts'

export type TierTarget = TierId | 'lead'

interface TiersState extends TiersView {
  models: ModelChoice[]
  open: boolean
  /** The card the lightbox opens on, when it was opened from one tier's label. */
  focus: TierTarget | null

  openTiers: (focus?: TierTarget) => void
  closeTiers: () => void
  /** Keeps tiers in the window only, as without a host, and closes the lightbox. */
  applyTiers: (config: TiersConfig, review?: ReviewTiers) => void
  /** Shows hobkin's tiers as its host answered them, from `tiers.read` or `tiers.apply`. */
  receiveHostTiers: (host: HostTiers) => void
  /** Shows what hobkin holds once part of an Apply went through, such as the lead it took before its tiers were refused. */
  receiveTiers: (view: TiersView) => void
}

/**
 * The tiers and whether their lightbox is open. With a host they are hobkin's own, read when the connection opens
 * (see TiersLightbox). Without one they are sample values, and applied ones are kept in the app's storage
 * (017-model-tiers, S3), so the ones the first-run setup proposes hold.
 */
export const useTiers = create<TiersState>()(
  persist(
    (set) => ({
      config: sampleTiers,
      review: DEFAULT_REVIEW_TIERS,
      follows: LEAD_FOLLOWS,
      checks: null,
      models: sampleModels,
      open: false,
      focus: null,

      openTiers: (focus) => set({ open: true, focus: focus ?? null }),
      closeTiers: () => set({ open: false }),
      applyTiers: (config, review) => set({ config, ...(review ? { review } : {}), open: false }),
      receiveHostTiers: (host) => set((state) => fromHost(host, state)),
      receiveTiers: (view) => set(view),
    }),
    {
      name: 'hobkin-client-tiers',
      // Version 2 adds the review roles. Whom each tier follows comes from the host each time, so it is not kept.
      version: 2,
      partialize: ({ config, review }) => ({ config, review }),
      migrate: (saved) => migrateSavedTiers(saved, sampleTiers),
    },
  ),
)
