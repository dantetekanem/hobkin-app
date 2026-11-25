import { EFFORTS, clampEffort, type Effort, type ModelChoice, type TierId } from '#shared/tiers/tiers.ts'
import type { RunSummary } from '#shared/protocol/snapshot.ts'
import type { ChangeTarget } from '../features/chat/send-change.ts'
import type { RunningAgent } from './running-agents.ts'

/**
 * The model an agent of the dock works on, for the pill at the end of its row, and what choosing another sends. Pure, so
 * the rules are tested without a window.
 */

/** A model as `provider/id`, and its thinking level, when known. */
export interface AgentModel {
  model: string | null
  effort: Effort | null
}

const NONE: AgentModel = { model: null, effort: null }

const effortOf = (level: string | undefined): Effort | null => ((EFFORTS as readonly string[]).includes(level ?? '') ? (level as Effort) : null)

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
  if (agent.durable) return agent.durable.engine.kind === 'claude' ? { why: 'On Claude Code it keeps its model.' } : { target: { hobkin: agent.durable.id } }
  if (agent.onClaudeCode) return { why: 'On Claude Code it keeps its model.' }
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
