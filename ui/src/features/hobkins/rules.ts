import type { CommandArgs } from '#shared/commands/registry.ts'
import { CLAUDE_MODELS, type ClaudeCodeSettings, type ClaudeModel } from '#shared/protocol/claude-code.ts'
import { HOBKIN_CLAUDE_EFFORTS, type HobkinClaudeEffort, type HobkinEngine } from '#shared/protocol/hobkins.ts'
import { TIER_IDS, TIER_INFO, clampEffort, type Effort, type ModelChoice, type TierId } from '#shared/tiers/tiers.ts'
import { modelName, shownTier, type TiersView } from '../tiers/host-tiers.ts'

/**
 * What the New hobkin sheet offers and when it may start one, and how a durable hobkin's page names what it runs on.
 * Pure, so the rules are tested without a window or a host. See _specs/034-durable-hobkins.
 */

/** One of the four tiers, with the model and thinking it runs on now. */
export interface TierOffer {
  kind: 'tier'
  tier: TierId
  label: string
  model: string
  effort: Effort | null
}

/** The installed Claude Code, with nothing asked, on a model and effort of its own. */
export interface ClaudeOffer {
  kind: 'claude'
  label: string
}

/** Any model Pi can reach now, with one of its own thinking levels. */
export interface CustomOffer {
  kind: 'pi'
  label: string
  models: readonly ModelChoice[]
}

export type EngineOffer = TierOffer | ClaudeOffer | CustomOffer

/** Claude Code's model and effort. `default` passes none, so Claude Code uses its own. */
export interface ClaudeChoice {
  model: ClaudeModel
  effort: HobkinClaudeEffort
}

/**
 * What runs it, as the form holds the choice: Custom may not have its model yet, and Claude Code just chosen has its
 * model and effort from `claudeStart` until the user changes them.
 */
export type EngineChoice =
  | { kind: 'tier'; tier: TierId }
  | ({ kind: 'claude' } & Partial<ClaudeChoice>)
  | { kind: 'pi'; model: string | null; effort: Effort | null }

/** Every model Claude Code offers, by name. */
export const CLAUDE_MODEL_CHOICES: readonly { value: ClaudeModel; label: string }[] = CLAUDE_MODELS.map((value) => ({
  value,
  label: value === 'default' ? 'Account default' : `${value[0]!.toUpperCase()}${value.slice(1)}`,
}))

const EFFORT_NAMES: Record<HobkinClaudeEffort, string> = { default: 'Default', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

/** Every effort Claude Code runs at, its own default first. */
export const CLAUDE_EFFORT_CHOICES: readonly { value: HobkinClaudeEffort; label: string }[] = HOBKIN_CLAUDE_EFFORTS.map((value) => ({ value, label: EFFORT_NAMES[value] }))

/** A model and effort as kept or read: a Claude choice, or the Claude Code tile's settings. Each is checked before use. */
type KeptClaude = Partial<ClaudeChoice> | Partial<Pick<ClaudeCodeSettings, 'model' | 'effort'>>

const oneOf = <Value extends string>(choices: readonly Value[], value: unknown): Value | undefined =>
  choices.includes(value as Value) ? (value as Value) : undefined

/**
 * Where Claude Code's model and effort start: what the last Claude hobkin used, else the Claude Code tile's own settings,
 * whose effort that follows the tier is Claude Code's default here. A kept choice it no longer has falls back the same way.
 */
export function claudeStart(last: KeptClaude | null | undefined, tile: KeptClaude | null | undefined): ClaudeChoice {
  return {
    model: oneOf(CLAUDE_MODELS, last?.model) ?? oneOf(CLAUDE_MODELS, tile?.model) ?? 'default',
    effort: oneOf(HOBKIN_CLAUDE_EFFORTS, last?.effort) ?? oneOf(HOBKIN_CLAUDE_EFFORTS, tile?.effort) ?? 'default',
  }
}

const CLAUDE_DEFAULTS: ClaudeChoice = { model: 'default', effort: 'default' }

interface OfferSources {
  tiers: Pick<TiersView, 'config' | 'follows' | 'checks'>
  models: readonly ModelChoice[]
  claudeInstalled: boolean
}

/**
 * What the form offers to run on: the four tiers, each with what it runs on now, Claude Code while it is installed, and
 * a model of the user's choosing while Pi can reach any.
 */
export function engineOffers({ tiers, models, claudeInstalled }: OfferSources): EngineOffer[] {
  const offers: EngineOffer[] = TIER_IDS.map((tier) => {
    const shown = shownTier(tiers, tier)
    return {
      kind: 'tier',
      tier,
      label: TIER_INFO[tier].label,
      model: modelName(shown, models),
      effort: shown.effort,
    }
  })
  if (claudeInstalled) offers.push({ kind: 'claude', label: 'Claude Code' })
  if (models.length) offers.push({ kind: 'pi', label: 'Custom', models })
  return offers
}

/** What `hobkin.start` takes for the choice, or null when it cannot run: Custom with no model, or one Pi does not reach now. */
export function engineOf(choice: EngineChoice | null, models: readonly ModelChoice[]): HobkinEngine | null {
  if (!choice) return null
  if (choice.kind === 'tier') return { kind: 'tier', tier: choice.tier }
  if (choice.kind === 'claude') return { kind: 'claude', ...claudeStart(choice, CLAUDE_DEFAULTS) }

  const model = models.find(({ id }) => id === choice.model)
  if (!model) return null
  // A model that does not think runs with thinking off. Any other runs at the level asked for, or its nearest.
  const effort = model.efforts.length ? clampEffort(model, choice.effort ?? 'medium') : 'off'
  return { kind: 'pi', model: model.id, effort }
}

/** Mid, where the form starts and where it falls back to. */
const MID: EngineChoice = { kind: 'tier', tier: 'mid' }

/**
 * The choice the form shows: what the user wanted, while the form offers it, and Mid otherwise. Whether Claude Code is
 * installed and which models Pi has are learned after the sheet opens, so the form keeps what was wanted and shows it
 * as soon as it can run, instead of settling on Mid. Claude Code shows the model and effort wanted, and `claude` where
 * none is.
 */
export function shownChoice(wanted: EngineChoice | null, offers: readonly EngineOffer[], claude: ClaudeChoice = CLAUDE_DEFAULTS): EngineChoice {
  if (!wanted || !offers.some((offer) => offer.kind === wanted.kind)) return MID
  return wanted.kind === 'claude' ? { kind: 'claude', ...claudeStart(wanted, claude) } : wanted
}

/** The user's home folder, as the host takes it. */
export const HOME_FOLDER = '~'

export interface FolderOffer {
  /** What `hobkin.start` takes: `~`, or a project's full path. */
  cwd: string
  label: string
  detail: string
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/**
 * The folders a durable hobkin may work in: the user's home, then each project hobkin knows that has a folder on this Mac,
 * in hobkin's order. `projects` is the snapshot's own work list, which carries each project's path; a dropped project is
 * left out, and so is one known only by its remote.
 */
export function folderOffers(projects: readonly unknown[] | undefined): FolderOffer[] {
  const offers: FolderOffer[] = [{ cwd: HOME_FOLDER, label: 'Home folder', detail: HOME_FOLDER }]
  for (const project of projects ?? []) {
    if (!isObject(project) || project.state === 'dropped') continue
    const { path } = project
    if (typeof path !== 'string' || !path.startsWith('/')) continue
    if (offers.some(({ cwd }) => cwd === path)) continue

    const name = typeof project.name === 'string' && project.name ? project.name : String(project.slug ?? path)
    offers.push({ cwd: path, label: name, detail: path })
  }
  return offers
}

/** The folder the form starts on: the last one chosen while it is still offered, or home. */
export function chosenFolder(offers: readonly FolderOffer[], last: string | null | undefined): string {
  return offers.find(({ cwd }) => cwd === last)?.cwd ?? HOME_FOLDER
}

export interface StartForm {
  cwd: string
  engine: HobkinEngine | null
  /** The prompt the sheet carries from the full prompt editor, if any. */
  text?: string
}

/**
 * What `hobkin.start` sends for the form, or null until it has a folder and something to run on. It takes no name, and
 * no first message unless the sheet carries a prompt: then that prompt is its first message. Without one the hobkin waits
 * for its first message on its page, and that message names it.
 */
export function startArgs({ cwd, engine, text }: StartForm): CommandArgs<'hobkin.start'> | null {
  const folder = cwd.trim()
  if (!folder || !engine) return null
  const words = text?.trim()
  return { cwd: folder, engine, ...(words ? { text: words } : {}) }
}

/** What a durable hobkin runs on, in a few words. */
export function engineLabel(engine: HobkinEngine, models: readonly ModelChoice[] = []): string {
  if (engine.kind === 'tier') return TIER_INFO[engine.tier].label
  if (engine.kind === 'claude') {
    // Its model and effort, where they are not Claude Code's own.
    const model = CLAUDE_MODEL_CHOICES.find(({ value }) => value !== 'default' && value === engine.model)?.label
    const effort = engine.effort && engine.effort !== 'default' ? EFFORT_NAMES[engine.effort].toLowerCase() : null
    return ['Claude Code', model, effort].filter(Boolean).join(' · ')
  }

  // A model Pi no longer lists goes by its id, without the provider.
  const listed = models.find(({ id }) => id === engine.model)
  const name = listed?.name ?? engine.model.slice(engine.model.indexOf('/') + 1)
  return `${name} · ${engine.effort}`
}

/** Whether it is at work on a turn, or waiting for the next message. */
export const stateLabel = (state: 'working' | 'waiting'): string => (state === 'working' ? 'working' : 'waiting')
