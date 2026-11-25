import { TIER_IDS, type ModelChoice, type TierId } from '#shared/tiers/tiers.ts'
import { modelWords, tierWords } from '../../app/agent-model.ts'

/**
 * What a subagent runs on, as its record says: its tier, its model and its thinking level, in the words the dock's
 * model pill uses (agent-model.ts). A part its record does not have is left out. Pure, so it is tested without a window.
 */
export interface RunsOn {
  /** hobkin's tier, or a pi-extended-teams tier such as `read-collect`. */
  modelSlot?: string
  model?: string
  thinking?: string
}

const isTier = (slot: string): slot is TierId => TIER_IDS.includes(slot as TierId)

/** Its tier as the pill names one: one of hobkin's by its label ("High tier"), a teams tier by its own name ("Read-collect tier"). */
export function tierName(slot: string | undefined): string | null {
  if (!slot) return null
  if (isTier(slot)) return tierWords(slot)
  return `${slot.charAt(0).toUpperCase()}${slot.slice(1)} tier`
}

const thinkingWords = (level: string) => (level === 'off' ? 'thinking off' : `${level} thinking`)

/** Its tier, its model by the name the window's model lists give it, and its thinking level, for a row. */
export function runsOnWords(agent: RunsOn, choices: readonly ModelChoice[]): string[] {
  const words = [
    tierName(agent.modelSlot),
    modelWords(agent.model ?? null, choices),
    agent.thinking ? thinkingWords(agent.thinking) : null,
  ]
  return words.filter((word): word is string => Boolean(word))
}

/** The same in full, for a hover, as the pill's hover says it: "Read-collect tier: openai-codex/gpt-6-luna at max". */
export function runsOnFull(agent: RunsOn): string {
  const tier = tierName(agent.modelSlot)
  const model = modelAtLevel(agent)
  if (tier && model) return `${tier}: ${model}`
  return tier ?? model
}

/** The whole model at its level, or the level alone when the model is not known. */
function modelAtLevel({ model, thinking }: RunsOn): string {
  if (model && thinking) return `${model} at ${thinking}`
  if (model) return model
  if (thinking) return thinkingWords(thinking)
  return ''
}
