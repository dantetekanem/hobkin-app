import { checkArguments, COMMANDS, type CommandArgs, type CommandName, type CommandResults } from '#shared/commands/registry.ts'
import type { CommandFailure } from '#shared/protocol/messages.ts'

/** A command that cannot run right now, with the reason for the person who asked. */
export class Unavailable extends Error {}

export type HostHandlers = {
  [Name in CommandName]?: (args: CommandArgs<Name>) => Promise<CommandResults[Name]> | CommandResults[Name]
}

export type CommandOutcome = { ok: true; value: unknown } | { ok: false; error: { code: CommandFailure; message: string } }

const failed = (code: CommandFailure, message: string): CommandOutcome => ({ ok: false, error: { code, message } })

/**
 * Runs one command by name. The arguments are checked against the command's schema first, so a handler is
 * never called with anything else, and hobkin never sees a request the registry does not describe.
 */
export async function runCommand(handlers: HostHandlers, name: string, args: unknown): Promise<CommandOutcome> {
  // A command that takes nothing may come with no arguments at all.
  const given = args ?? {}
  const check = checkArguments(name, given)
  if (!check.ok) return failed(check.code, check.message)

  const command = name as CommandName
  const handler = handlers[command] as ((args: unknown) => unknown) | undefined
  if (COMMANDS[command].runs !== 'host' || !handler) return failed('unavailable', `${name} does not run in the host.`)

  try {
    return { ok: true, value: await handler(given) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return failed(error instanceof Unavailable ? 'unavailable' : 'failed', message)
  }
}
