import { createStore } from 'zustand/vanilla'
import type { CommandArgs, CommandName, CommandResults } from '#shared/commands/registry.ts'
import type { PresenceMessage } from '#shared/protocol/messages.ts'
import type { QuestionReply } from '#shared/protocol/question.ts'
import { HostConnection } from './connection.ts'
import { discoverHost } from './discover.ts'
import { applyHostMessage, applyLink, initialHostState, type HostState } from './state.ts'

/** Everything the host has told this window. Components read it through the hooks in `hooks.ts`. */
export const hostStore = createStore<HostState>(() => initialHostState)

const connection = new HostConnection({
  discover: discoverHost,
  onMessage: (message) => hostStore.setState((state) => applyHostMessage(state, message), true),
  onLink: (link) => hostStore.setState((state) => applyLink(state, link), true),
})

/** Connects to the host and keeps the connection up. Returns how to stop. */
export function startHostConnection(): () => void {
  connection.start()
  return () => connection.stop()
}

/**
 * Runs a command from the registry in the host. Every click and key that changes something goes through here,
 * so hobkin can do the same thing by the same name. Rejects with the host's reason.
 */
export function runCommand<Name extends CommandName>(name: Name, ...args: {} extends CommandArgs<Name> ? [args?: CommandArgs<Name>] : [args: CommandArgs<Name>]): Promise<CommandResults[Name]> {
  return connection.command(name, (args[0] ?? {}) as CommandArgs<Name>)
}

/** Tells hobkin whether the user is here, for its rules about when to ask something. */
export function reportPresence(presence: Omit<PresenceMessage, 'type'>): void {
  connection.send({ type: 'presence', ...presence })
}

/** Answers the question hobkin is asking: one of its choices by value, or the user's own words. */
export async function answerQuestion(id: string, answer: QuestionReply): Promise<void> {
  await runCommand('question.answer', { id, ...answer })
}

/** "Later": the question leaves the screen and waits under Action items, as it does by itself after thirty seconds. */
export async function deferQuestion(id: string): Promise<void> {
  await runCommand('question.defer', { id })
}

/** A thinking level hobkin's main conversation takes. */
export type MainEffort = NonNullable<CommandArgs<'models.select'>['effort']>

/**
 * Chooses hobkin's main model, as `provider/id` from `useModels().models`, and optionally its thinking level, one of
 * that model's `thinking`. hobkin saves both in its config.json and the open conversation goes on with them at once.
 * Without a level, hobkin keeps the one it has. Rejects with the host's reason, such as a provider that is not
 * connected. The conversation's model shows in `useMainModel()` once applied.
 */
export function selectMainModel(model: string, effort?: MainEffort): Promise<CommandResults['models.select']> {
  return runCommand('models.select', { model, ...(effort ? { effort } : {}) })
}
