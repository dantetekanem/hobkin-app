import { createStore, type StoreApi } from 'zustand/vanilla'
import type { CommandArgs, CommandName, CommandResults } from '#shared/commands/registry.ts'
import type { PresenceMessage } from '#shared/protocol/messages.ts'
import type { QuestionReply } from '#shared/protocol/question.ts'
import type { HostTiers, TiersChange } from '#shared/tiers/tiers.ts'
import { HostConnection } from './connection.ts'
import { discoverHost } from './discover.ts'
import { explainRefusal } from './refusal.ts'
import { applyHostMessage, applyLink, initialHostState, type HostState } from './state.ts'

/** The window's one store and connection, and how many hold the connection open. */
interface Kept {
  store: StoreApi<HostState>
  connection: HostConnection
  holds: number
}

function keep(): Kept {
  const store = createStore<HostState>(() => initialHostState)
  const connection = new HostConnection({
    discover: discoverHost,
    onMessage: (message) => store.setState((state) => applyHostMessage(state, message), true),
    onLink: (link) => store.setState((state) => applyLink(state, link), true),
  })
  return { store, connection, holds: 0 }
}

// The pair lives on globalThis, so when a hot update runs this file again it finds the running pair instead of
// making a second one that nothing starts, which left the window on sample data. The window keeps the connection
// code it opened with until it reloads. A copy of this file from before kept nothing here: its window reloads once.
const holder = globalThis as { __hobkinHost?: Kept }
if (!holder.__hobkinHost && typeof document !== 'undefined' && document.getElementById('root')?.hasChildNodes()) location.reload()
const kept = (holder.__hobkinHost ??= keep())
const { connection } = kept

/** Everything the host has told this window. Components read it through the hooks in `hooks.ts`. */
export const hostStore = kept.store

/**
 * Connects to the host and keeps the connection up. Returns how to let go of it. It closes a moment after the last
 * hold lets go, so a hot update, which lets go and takes hold again at once, keeps it open.
 */
export function startHostConnection(): () => void {
  kept.holds += 1
  connection.start()
  let held = true
  return () => {
    if (!held) return
    held = false
    kept.holds -= 1
    setTimeout(() => kept.holds === 0 && connection.stop(), 0)
  }
}

/**
 * Runs a command from the registry in the host. Every click and key that changes something goes through here,
 * so hobkin can do the same thing by the same name. Rejects with the host's reason, or with what fixes it when the
 * running host is older than this window and does not know the command yet.
 */
export function runCommand<Name extends CommandName>(name: Name, ...args: {} extends CommandArgs<Name> ? [args?: CommandArgs<Name>] : [args: CommandArgs<Name>]): Promise<CommandResults[Name]> {
  return connection.command(name, (args[0] ?? {}) as CommandArgs<Name>).catch((error: unknown) => {
    throw explainRefusal(error)
  })
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

/** Reads hobkin's tiers from its config.json: the chat's model, each tier as it runs now, and the tier of each review role. */
export function readTiers(): Promise<HostTiers> {
  return runCommand('tiers.read')
}

/**
 * Saves tiers and review roles in hobkin's config.json, all in one write or none, and answers the tiers as saved. A tier
 * given null follows again. Rejects with the host's reason, such as a model Pi cannot use now.
 */
export function applyTiers(change: TiersChange): Promise<HostTiers> {
  return runCommand('tiers.apply', change)
}
