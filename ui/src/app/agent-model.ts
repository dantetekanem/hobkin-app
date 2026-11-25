import { EFFORTS, TIER_IDS, TIER_INFO, clampEffort, type Effort, type ModelChoice, type TierId } from '#shared/tiers/tiers.ts'
import type { RunSummary } from '#shared/protocol/snapshot.ts'
import type { ChangeTarget } from '../features/chat/send-change.ts'
import type { RunningAgent } from './running-agents.ts'

/**
 * The tier or model an agent of the dock works on, for the pill at the end of its row, and what choosing another sends.
 * Pure, so the rules are tested without a window.
 */

/** A model as `provider/id`, and its thinking level, when known. */
export interface AgentModel {
  model: string | null
  effort: Effort | null
}

const NONE: AgentModel = { model: null, effort: null }

/** A level as the host sends it, or null for one the window does not know. */
function effortOf(level: string | undefined): Effort | null {
  const known = EFFORTS.find((effort) => effort === level)
  return known ?? null
}

/**
 * What an agent works on: its run's own model, a durable hobkin's engine, or, between a tier hobkin's turns and for a
 * sample agent with no host (`run` undefined), what its tier runs with now. A run that names no model has none: a
 * running agent keeps the model it started on, so its tier says nothing of it.
 */
export function agentModelOf(
  agent: Pick<RunningAgent, 'tier' | 'durable'>,
  run: Pick<RunSummary, 'model' | 'effort'> | undefined,
  tierModel: (tier: TierId) => AgentModel,
): AgentModel {
  const engine = agent.durable?.engine
  if (engine?.kind === 'pi') return { model: engine.model, effort: engine.effort }
  if (engine?.kind === 'claude') return { model: `claude-code/${engine.model ?? 'default'}`, effort: effortOf(engine.effort) }
  if (run) return run.model ? { model: run.model, effort: effortOf(run.effort) } : NONE
  return tierModel(engine?.kind === 'tier' ? engine.tier : agent.tier)
}

const isTier = (value: unknown): value is TierId => TIER_IDS.includes(value as TierId)

/** The tier on the agent's own record: a durable hobkin's tier engine, a run's tier from hobkin, or a sample agent's. */
function recordedTier(agent: Pick<RunningAgent, 'tier' | 'durable'>, run: Pick<RunSummary, 'tier'> | undefined): TierId | null {
  const engine = agent.durable?.engine
  if (engine) return engine.kind === 'tier' ? engine.tier : null
  if (!run) return agent.tier
  return isTier(run.tier) ? run.tier : null
}

/** Whether an agent works on what a tier runs with: the same model, and the same level where both are known. */
const runsWith = (tier: AgentModel, current: AgentModel) =>
  tier.model === current.model && (tier.effort === null || current.effort === null || tier.effort === current.effort)

/**
 * The tier an agent runs on now, for the pill, or null when it runs on a model of its own. The tier comes from the
 * agent's record, never from its model alone: a routine on no tier is not read as the tier that runs the same model.
 * hobkin keeps a run's tier when its model changes, so the record stands only while the agent works on what that tier
 * runs with now; moved to another tier's model and level, it runs on that one. A durable hobkin moved to a tier from
 * the pill is saved on that tier's Pi model, so a Pi engine runs on the tier it matches. On Claude Code the record
 * stands: its model is never a tier's, and hobkin cannot change it.
 */
export function agentTierOf(
  agent: Pick<RunningAgent, 'tier' | 'durable' | 'onClaudeCode'>,
  run: Pick<RunSummary, 'tier'> | undefined,
  current: AgentModel,
  tierModel: (tier: TierId) => AgentModel,
): TierId | null {
  const recorded = recordedTier(agent, run)
  if (agent.onClaudeCode && !agent.durable) return recorded
  if (!recorded && agent.durable?.engine.kind !== 'pi') return null
  if (current.model === null) return recorded
  if (recorded && (tierModel(recorded).model === null || runsWith(tierModel(recorded), current))) return recorded
  return TIER_IDS.find((tier) => tier !== recorded && runsWith(tierModel(tier), current)) ?? null
}

/** A tier in the pill's few words. */
export const tierWords = (tier: TierId): string => `${TIER_INFO[tier].label} tier`

/**
 * What choosing a tier sends: what it runs with now, only the parts that differ from what the agent works on. Null for
 * what the agent works on already, and for a tier whose model the window cannot name.
 */
export function changeForTier(current: AgentModel, tier: AgentModel): { model?: string; effort?: Effort } | null {
  if (!tier.model) return null
  const change = {
    ...(tier.model === current.model ? {} : { model: tier.model }),
    ...(tier.effort && tier.effort !== current.effort ? { effort: tier.effort } : {}),
  }
  return Object.keys(change).length ? change : null
}

/** The model in the pill's few words: the name the window's model lists give it, or its id without the provider. */
export function modelWords(model: string | null, choices: readonly ModelChoice[]): string | null {
  if (!model) return null
  // Claude Code's own default is the account's model, which the window cannot name.
  if (model === 'claude-code/default') return 'claude'
  const named = choices.find((choice) => choice.id === model)?.name
  if (named) return named
  const slash = model.indexOf('/')
  return slash < 0 ? model : model.slice(slash + 1)
}

/**
 * Where a change for this agent goes, or why it has none: a working run by its run (`agent.change`), a durable hobkin
 * by its id (`hobkin.change`). hobkin refuses both for Claude Code, and a run that waits for its time is not working.
 */
export function changeTarget(agent: Pick<RunningAgent, 'id' | 'durable' | 'onClaudeCode' | 'waits'>): { target: ChangeTarget } | { why: string } {
  const onClaudeCode = agent.durable ? agent.durable.engine.kind === 'claude' : agent.onClaudeCode === true
  if (onClaudeCode) return { why: 'On Claude Code it keeps its model.' }
  if (agent.durable) return { target: { hobkin: agent.durable.id } }
  if (agent.waits !== undefined) return { why: 'It waits for its time. Its model changes while it works.' }
  return { target: { agent: agent.id } }
}

/** What choosing `choice` sends: the model, with the level carried over or moved to the nearest one it offers. Null for its own model. */
export function changeFor(current: AgentModel, choice: ModelChoice): { model: string; effort?: Effort } | null {
  if (choice.id === current.model) return null
  if (!current.effort || choice.efforts.length === 0) return { model: choice.id }
  return { model: choice.id, effort: clampEffort(choice, current.effort) }
}

/** The thinking levels of the model the agent works on, or none when the window does not know it. */
export function effortsOf(model: string | null, choices: readonly ModelChoice[]): readonly Effort[] {
  return choices.find((choice) => choice.id === model)?.efforts ?? []
}
