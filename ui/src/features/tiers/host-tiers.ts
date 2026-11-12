import {
  DEFAULT_REVIEW_TIERS,
  REVIEW_ROLES,
  TIER_IDS,
  type Effort,
  type HostTiers,
  type ModelChoice,
  type ReviewTiers,
  type TierId,
  type TierSetting,
  type TiersChange,
  type TiersConfig,
} from '#shared/tiers/tiers.ts'

/**
 * How the Models window holds hobkin's tiers, and what it sends back. Pure rules, so they are tested without a
 * window or a host. The host's side is `tiers.read` and `tiers.apply` (017-model-tiers).
 */

/** Whose model a tier runs with while it has none of its own: the chat's (`main`) or the checks' (`background`). */
export type Follows = 'main' | 'background'

/** What the checks run with. A null model is Pi's own default. */
export interface Followed {
  model: string | null
  effort: Effort
}

/** hobkin's tiers as the window holds them. */
export interface TiersView {
  config: TiersConfig
  review: ReviewTiers
  /** Whose model each tier follows while it has none of its own. */
  follows: Record<TierId, Follows>
  /** What the checks run with, once hobkin has said. It says so only through a tier that follows them. */
  checks: Followed | null
}

/** Without a host every unset tier follows the lead, as the window has always shown. */
export const LEAD_FOLLOWS: Record<TierId, Follows> = { fast: 'main', mid: 'main', high: 'main', max: 'main' }

/**
 * hobkin's own rule (`src/cli/tiers.mjs` in hobkin): fast follows the checks' model and the others the chat's. hobkin
 * says whom a tier follows only while it follows, so this names whom a tier with a model of its own would follow again.
 */
export const HOBKIN_FOLLOWS: Record<TierId, Follows> = { fast: 'background', mid: 'main', high: 'main', max: 'main' }

/**
 * What the window shows once hobkin has answered. `shown` is what it showed before: its lead stays when hobkin has no
 * model for the chat, and its checks stay when no tier follows them now.
 */
export function fromHost(host: HostTiers, shown: Pick<TiersView, 'config' | 'checks'>): TiersView {
  const tiers = {} as Record<TierId, TierSetting | null>
  const follows = {} as Record<TierId, Follows>
  let checks = shown.checks
  for (const tier of TIER_IDS) {
    const { model, effort, follows: whose } = host.tiers[tier]
    tiers[tier] = whose === null && model ? { model, effort } : null
    follows[tier] = whose ?? HOBKIN_FOLLOWS[tier]
    if (whose === 'background') checks = { model, effort }
  }
  const lead = host.lead.model ? { model: host.lead.model, effort: host.lead.effort } : shown.config.lead
  return { config: { lead, tiers }, review: { ...host.review }, follows, checks }
}

const sameSetting = (a: TierSetting | null, b: TierSetting | null) => a === b || (a !== null && b !== null && a.model === b.model && a.effort === b.effort)

/**
 * What `tiers.apply` needs to turn `saved` into `draft`: each tier and review role that changed, a tier that follows
 * again as null. Null when nothing did, since hobkin refuses an empty change. The lead is not in it: it goes through
 * `models.select`.
 */
export function tiersChange(saved: Pick<TiersView, 'config' | 'review'>, draft: Pick<TiersView, 'config' | 'review'>): TiersChange | null {
  const tiers: NonNullable<TiersChange['tiers']> = {}
  for (const tier of TIER_IDS) {
    const after = draft.config.tiers[tier]
    if (!sameSetting(saved.config.tiers[tier], after)) tiers[tier] = after ? { model: after.model, effort: after.effort } : null
  }
  const review: NonNullable<TiersChange['review']> = {}
  for (const role of REVIEW_ROLES) if (saved.review[role] !== draft.review[role]) review[role] = draft.review[role]

  const change: TiersChange = {}
  if (Object.keys(tiers).length) change.tiers = tiers
  if (Object.keys(review).length) change.review = review
  return change.tiers || change.review ? change : null
}

/** One tier as the window shows it. */
export interface ShownTier {
  /** Pi's `provider/id`. Null when what it follows runs on Pi's own default, or, with no effort either, when hobkin has not said what the checks run with. */
  model: string | null
  effort: Effort | null
  /** Whose model it follows; null once it has its own. */
  follows: Follows | null
}

/** What a tier runs with: its own setting, the lead's, or the checks'. */
export function shownTier(view: Pick<TiersView, 'config' | 'follows' | 'checks'>, tier: TierId): ShownTier {
  const own = view.config.tiers[tier]
  if (own) return { ...own, follows: null }
  if (view.follows[tier] === 'background') return { model: view.checks?.model ?? null, effort: view.checks?.effort ?? null, follows: 'background' }
  return { ...view.config.lead, follows: 'main' }
}

/** The setting a tier takes when it stops following: what it runs with now, or the lead's when that is not a model the window can name. */
export function ownSetting(shown: ShownTier, lead: TierSetting): TierSetting {
  return shown.model && shown.effort ? { model: shown.model, effort: shown.effort } : lead
}

/** The name the window shows for a tier's model. */
export function modelName(shown: ShownTier, models: readonly ModelChoice[]): string {
  if (shown.model) return models.find((model) => model.id === shown.model)?.name ?? shown.model
  return shown.effort ? "Pi's default" : 'The checks model'
}

const FOLLOWED: Record<Follows, string> = { main: 'hobkin', background: 'checks' }

/** Whose model a tier follows, in the card's few words, and the button that makes it follow again. */
export function followsWords(follows: Follows): { follows: string; follow: string } {
  return { follows: `Follows ${FOLLOWED[follows]}`, follow: `Follow ${FOLLOWED[follows]}` }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/**
 * The window's saved tiers from an earlier version. Version 1 kept only `config`, from before the review roles, which
 * start at their defaults. A saved value that is not tiers gives way to `fallback`, so the window starts over instead of failing.
 */
export function migrateSavedTiers(saved: unknown, fallback: TiersConfig): Pick<TiersView, 'config' | 'review'> {
  const config = isObject(saved) && isObject(saved.config) && isObject(saved.config.lead) && isObject(saved.config.tiers) ? (saved.config as unknown as TiersConfig) : fallback
  return { config, review: DEFAULT_REVIEW_TIERS }
}
