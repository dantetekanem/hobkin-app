import type { SlashCommand } from '#shared/protocol/slash.ts'
import { slashCommandIn, slashKey, type SlashKey, type SlashState } from '../chat/slash.ts'

/**
 * The commands of an agent's message box, for a message that starts with a slash: the window's own for how the agent
 * works, then what Pi offers that agent's own session (`slash.list` with the agent). The list and its keys are the main
 * chat's (`chat/slash.ts`); this says what choosing a command does here. Pure, so the rules are tested without a window.
 */

const MODEL = '/model'
const EFFORT = '/effort'

/** The window's own: /model opens the choice of tier or model the dock's pill has, and /effort takes a level after it. */
const OWN: readonly SlashCommand[] = [
  { name: MODEL, description: 'choose its tier or model', source: 'hobkin', count: 0 },
  { name: EFFORT, description: 'set its thinking level, such as /effort high', source: 'hobkin', count: 0 },
]

/** The window's own first, then Pi's, leaving out one of Pi's that takes the same name. */
export function agentCommands(pi: readonly SlashCommand[]): SlashCommand[] {
  return [...OWN, ...pi.filter(({ name }) => !OWN.some((own) => own.name === name))]
}

/** What a chosen command does: open the choice of tier or model, or run one of Pi's in the agent's session. */
export type AgentSlashRun = { kind: 'model' } | { kind: 'pi'; name: string; args: string }

export interface AgentSlashKeyResult {
  state: SlashState
  /** What the input holds now, when the key changed it. */
  text?: string
  run?: AgentSlashRun
}

/**
 * What a key does while the list is open, or null when the key is not the list's, as in the main chat. Enter on /model
 * opens the choice; on /effort it writes the command out, ready for its level, since it means nothing alone.
 */
export function agentSlashKey(input: { text: string; commands: readonly SlashCommand[]; state: SlashState }, key: SlashKey): AgentSlashKeyResult | null {
  const result = slashKey(input, key)
  if (!result) return null

  const { state, text, run } = result
  if (!run) return text === undefined ? { state } : { state, text }
  if (run.name === EFFORT) return { state, text: `${EFFORT} ` }

  const chosen: AgentSlashRun = run.name === MODEL ? { kind: 'model' } : { kind: 'pi', name: run.name, args: '' }
  return { state, text: '', run: chosen }
}

/**
 * What a finished message does when it is a command: a bare /model opens the choice, and one of Pi's runs with what
 * follows it. Null for anything else, a /model or /effort line with words after it included, which changes the agent
 * as it did before the list (`changeLine`).
 */
export function agentSlashSent(text: string, commands: readonly SlashCommand[]): AgentSlashRun | null {
  const command = slashCommandIn(text.trim(), commands)
  if (!command || command.name === EFFORT) return null
  if (command.name === MODEL) return command.args ? null : { kind: 'model' }
  return { kind: 'pi', ...command }
}
