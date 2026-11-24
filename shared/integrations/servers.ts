import { isCommandEntry } from './entry.ts'
import type { PiServerEntry, ServerKind, ToolEffect } from './types.ts'

/** The rules for configured servers: where one lives, and what its tools do. No React, no DOM, no file access. */

/** What to show for where a server lives: the address of a remote one, the command line of a local one. */
export function targetOf(entry: PiServerEntry): { kind: ServerKind; text: string } {
  if (isCommandEntry(entry)) return { kind: 'command', text: [entry.command, ...(entry.args ?? [])].join(' ') }
  return { kind: 'remote', text: entry.url }
}

/**
 * Whether a tool reads or changes, from the hints its server declares (MCP tool annotations).
 * A tool counts as changing unless its server says it only reads, because a wrong "reads" is the costly mistake.
 */
export function toolEffect(hints: { readOnlyHint?: boolean; destructiveHint?: boolean } | undefined): ToolEffect {
  return hints?.readOnlyHint === true && hints.destructiveHint !== true ? 'reads' : 'changes'
}
