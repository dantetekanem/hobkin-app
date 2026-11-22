import {
  CLAUDE_MODELS,
  changeClaudeCode,
  claudeCodeSettings,
  type ClaudeCodeChange,
  type ClaudeCodeSettings,
  type ClaudeCodeStatus,
  type ClaudeModel,
} from '../protocol/claude-code.ts'
import { TIER_IDS, clampEffort, setTierModel, type Effort, type ModelChoice, type TierId, type TierSetting, type TiersConfig } from './tiers.ts'

/**
 * Tiers on Claude Code (033-claude-code-agents, 2026-11-21). A tier may run on Claude Code with a Claude model and level
 * of its own. It keeps its Pi model in hobkin's config, which runs whatever cannot run on Claude Code, and the host keeps
 * which tiers run on Claude Code in `claude-code.json`, beside its other Claude Code settings. Pure rules, shared by the
 * host and the window.
 */

/** The thinking levels Claude Code takes, weakest first. It has nothing below low. */
export const CLAUDE_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly Effort[]
export type ClaudeLevel = (typeof CLAUDE_LEVELS)[number]

/** A tier on Claude Code: the Claude model it runs with there, and how hard it thinks. */
export interface ClaudeTier {
  model: ClaudeModel
  effort: ClaudeLevel
}
export type ClaudeTiers = Partial<Record<TierId, ClaudeTier>>
/** A tier given a Claude choice runs on Claude Code, and one given null goes back to its Pi model. Whatever is left out stays. */
export type ClaudeTiersChange = Partial<Record<TierId, ClaudeTier | null>>

/** The Claude Code settings as a host that keeps tiers on Claude Code holds them. */
export type ClaudeCodeWithTiers = ClaudeCodeSettings & { tiers: ClaudeTiers }
export type ClaudeCodeWithTiersChange = ClaudeCodeChange & { tiers?: ClaudeTiersChange }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isOneOf = <Word extends string>(words: readonly Word[], value: unknown): value is Word => words.includes(value as Word)

/** Tiers on Claude Code from a file or a message. Anything that is not one of the four tiers with a Claude model and level is left out. */
export function claudeTiers(value: unknown): ClaudeTiers {
  const given = isObject(value) ? value : {}
  const tiers: ClaudeTiers = {}
  for (const tier of TIER_IDS) {
    const own = given[tier]
    if (isObject(own) && isOneOf(CLAUDE_MODELS, own.model) && isOneOf(CLAUDE_LEVELS, own.effort)) tiers[tier] = { model: own.model, effort: own.effort }
  }
  return tiers
}

/** The tiers on Claude Code a host reports with its settings, or null for a host from before them, which cannot keep any. */
export function claudeTiersOf(settings: unknown): ClaudeTiers | null {
  return isObject(settings) && isObject(settings.tiers) ? claudeTiers(settings.tiers) : null
}

/** The settings `claude-code.json` holds. One saved before tiers could run on Claude Code has none there. */
export function claudeCodeWithTiers(value: unknown): ClaudeCodeWithTiers {
  return { ...claudeCodeSettings(value), tiers: claudeTiers(isObject(value) ? value.tiers : null) }
}

/** The tiers on Claude Code after a change. */
export function changeClaudeTiers(tiers: ClaudeTiers, change: ClaudeTiersChange): ClaudeTiers {
  const next: Record<string, unknown> = { ...tiers }
  for (const tier of TIER_IDS) if (tier in change) next[tier] = change[tier]
  return claudeTiers(next)
}

/**
 * The settings after a change. Settings that came with no tiers, from a host before them, stay without, so a change
 * the window shows never makes such a host look as if it kept them.
 */
export function changeClaudeCodeSettings<Settings extends ClaudeCodeSettings>(settings: Settings, change: ClaudeCodeWithTiersChange): Settings {
  const { tiers, ...rest } = change
  const next = changeClaudeCode(settings, rest)
  const kept = claudeTiersOf(settings)
  return (kept === null ? next : { ...next, tiers: tiers ? changeClaudeTiers(kept, tiers) : kept }) as Settings
}

/** The group of the model list a tier's Claude Code choices are in. */
export const CLAUDE_CODE = 'Claude Code'

const NAMES: Record<ClaudeModel, string> = { default: 'Account default', opus: 'opus', sonnet: 'sonnet', haiku: 'haiku', fable: 'fable' }
// Pi names its models `provider/id`, and no provider of Pi's is called this.
const PREFIX = 'claude-code/'

/** Claude Code's models as the model list offers them, after Pi's, each thinking at Claude Code's levels. */
export function claudeChoices(): ModelChoice[] {
  return CLAUDE_MODELS.map((model) => ({ id: `${PREFIX}${model}`, name: NAMES[model], provider: CLAUDE_CODE, efforts: CLAUDE_LEVELS }))
}

/** The Claude model a choice in the list stands for, or null for one of Pi's. */
export function claudeModelOf(id: string | null): ClaudeModel | null {
  const model = id?.startsWith(PREFIX) ? id.slice(PREFIX.length) : null
  return isOneOf(CLAUDE_MODELS, model) ? model : null
}

/** A tier on Claude Code as its card shows it: the list's Claude choice and its level. Null for a tier on its Pi model. */
export function shownClaude(tiers: ClaudeTiers, tier: TierId): { model: string; effort: Effort; follows: null } | null {
  const own = tiers[tier]
  return own ? { model: `${PREFIX}${own.model}`, effort: own.effort, follows: null } : null
}

/** A tier on Claude Code in the Models tile's few words. */
export function claudeTierName(tier: ClaudeTier): string {
  return `${CLAUDE_CODE} · ${NAMES[tier.model]}`
}

/** The Claude Code group of one card's model list: its models, or the one line that says why it has none. */
export type ClaudeGroup = { offered: true } | { offered: false; note: string }

const LEAD_ON_PI = "hobkin's chat runs on Pi, so only the four tiers can run on Claude Code."
const NOT_FOUND = 'Claude Code is not installed on this Mac. Get it in Subscriptions, then choose it here.'

/**
 * The Claude Code group for the lead's list or a tier's, from what `claude-code.read` said. None before the host has
 * said, or when it reports no tiers: a host from before cannot keep a tier on Claude Code, so nothing offers it.
 */
export function claudeGroup(target: TierId | 'lead', state: { status: ClaudeCodeStatus; settings: unknown } | null): ClaudeGroup | null {
  if (!state || claudeTiersOf(state.settings) === null) return null
  if (target === 'lead') return { offered: false, note: LEAD_ON_PI }
  return state.status.installed ? { offered: true } : { offered: false, note: NOT_FOUND }
}

/** The lightbox's draft: hobkin's own tiers, and the tiers on Claude Code. */
export interface TiersDraft {
  config: TiersConfig
  claude: ClaudeTiers
}

/** What a card shows a tier running with now. The model is null when the window cannot name it. */
export interface TierNow {
  model: string | null
  effort: Effort | null
}

const without = (tiers: ClaudeTiers, tier: TierId): ClaudeTiers => Object.fromEntries(Object.entries(tiers).filter(([name]) => name !== tier))

/** The setting a tier takes when it stops following: what it runs with now, or the lead's when the window cannot name that. */
const ownOf = (now: TierNow, lead: TierSetting): TierSetting => (now.model && now.effort ? { model: now.model, effort: now.effort } : lead)

/**
 * A model chosen for the lead or a tier. A Claude model puts the tier on Claude Code and leaves its Pi model as it is.
 * A Pi model takes Claude Code off and becomes the tier's own, from the level it showed. A level the model lacks moves
 * to the nearest one it has, and `effortMovedFrom` names the old one. The lead runs on Pi only.
 */
export function chooseModel(draft: TiersDraft, target: TierId | 'lead', choice: ModelChoice, now: TierNow): { draft: TiersDraft; effortMovedFrom: Effort | null } {
  const claude = claudeModelOf(choice.id)
  if (claude && target === 'lead') return { draft, effortMovedFrom: null }
  if (claude && target !== 'lead') {
    const from = now.effort ?? draft.config.lead.effort
    const effort = clampEffort(choice, from) as ClaudeLevel
    return { draft: { ...draft, claude: { ...draft.claude, [target]: { model: claude, effort } } }, effortMovedFrom: effort === from ? null : from }
  }
  if (target === 'lead') {
    const result = setTierModel(draft.config, 'lead', choice)
    return { draft: { ...draft, config: result.config }, effortMovedFrom: result.effortMovedFrom }
  }
  const from = { ...draft.config, tiers: { ...draft.config.tiers, [target]: ownOf(now, draft.config.lead) } }
  const result = setTierModel(from, target, choice)
  return { draft: { config: result.config, claude: without(draft.claude, target) }, effortMovedFrom: result.effortMovedFrom }
}

/** A level chosen on a card: the tier's Claude level while it runs on Claude Code, and its Pi level otherwise. */
export function chooseLevel(draft: TiersDraft, target: TierId | 'lead', effort: Effort, now: TierNow): TiersDraft {
  const onClaude = target === 'lead' ? undefined : draft.claude[target]
  if (onClaude) return isOneOf(CLAUDE_LEVELS, effort) ? { ...draft, claude: { ...draft.claude, [target]: { ...onClaude, effort } } } : draft
  // Levels are offered only for a model the window can name.
  if (!now.model) return draft
  const setting = { model: now.model, effort }
  return { ...draft, config: target === 'lead' ? { ...draft.config, lead: setting } : { ...draft.config, tiers: { ...draft.config.tiers, [target]: setting } } }
}

/** A tier that follows again follows on Pi, so it comes off Claude Code too. */
export function followAgain(draft: TiersDraft, tier: TierId): TiersDraft {
  return { config: { ...draft.config, tiers: { ...draft.config.tiers, [tier]: null } }, claude: without(draft.claude, tier) }
}

/** What `claude-code.apply` needs to turn `saved` into `draft`: each tier put on Claude Code or changed, one taken off as null. Null when nothing changed. */
export function claudeTiersChange(saved: ClaudeTiers, draft: ClaudeTiers): ClaudeTiersChange | null {
  const change: ClaudeTiersChange = {}
  for (const tier of TIER_IDS) {
    const before = saved[tier]
    const after = draft[tier]
    if (before?.model !== after?.model || before?.effort !== after?.effort) change[tier] = after ?? null
  }
  return Object.keys(change).length ? change : null
}
