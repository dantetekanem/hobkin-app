import { checkArguments, commandDefinition, type CommandArgs, type CommandName, type CommandResults } from '#shared/commands/registry.ts'
import type { CommandFailure } from '#shared/protocol/messages.ts'
import type { CommandDone, CommandSource } from './integration-contract.ts'

/** A command that cannot run right now, with the reason for the person who asked. */
export class Unavailable extends Error {}

export type HostHandlers = {
  [Name in CommandName]?: (args: CommandArgs<Name>) => Promise<CommandResults[Name]> | CommandResults[Name]
}

/** Handlers by command name: the core's, typed, and an integration's, which the registry checks at run time. */
export type HandlerSet = { readonly [name: string]: ((args: never) => unknown) | undefined }

/** What integrations hear of a command (`beforeCommand`, `afterCommand`), and who ran it. */
export interface CommandHooks {
  from: CommandSource
  /** The reason a part refused the command before it ran, or null. */
  before(call: { name: string; args: unknown; from: CommandSource }): Promise<string | null>
  after(done: CommandDone): void
}

export type CommandOutcome = { ok: true; value: unknown } | { ok: false; error: { code: CommandFailure; message: string } }

const failed = (code: CommandFailure, message: string): CommandOutcome => ({ ok: false, error: { code, message } })

/**
 * Runs one command by name. The arguments are checked against the command's schema first, so a handler is
 * never called with anything else, and hobkin never sees a request the registry does not describe.
 */
export async function runCommand(handlers: HandlerSet, name: string, args: unknown, hooks?: CommandHooks): Promise<CommandOutcome> {
  // A command that takes nothing may come with no arguments at all.
  const given = args ?? {}
  const check = checkArguments(name, given)
  if (!check.ok) return failed(check.code, check.message)
  if (!hooks) return perform(handlers, name, given)

  const call = { name, args: given, from: hooks.from }
  const refusal = await hooks.before(call)
  const outcome = refusal === null ? await perform(handlers, name, given) : failed('unavailable', refusal)
  hooks.after({ ...call, outcome })
  return outcome
}

async function perform(handlers: HandlerSet, name: string, given: unknown): Promise<CommandOutcome> {
  const handler = handlers[name] as ((args: unknown) => unknown) | undefined
  if (commandDefinition(name)?.runs !== 'host' || !handler) return failed('unavailable', `${name} does not run in the host.`)

  try {
    return { ok: true, value: await handler(given) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return failed(error instanceof Unavailable ? 'unavailable' : 'failed', message)
  }
}
