import type { CommandServerEntry, PiServerEntry } from './types.ts'

/**
 * Reading an `mcpServers` entry, and turning it off and on. An entry may refer to an environment variable as
 * `${NAME}`, which Pi resolves when it connects. That is never a secret.
 */

export function isCommandEntry(entry: PiServerEntry): entry is CommandServerEntry {
  return typeof entry.command === 'string'
}

/**
 * The entry turned off or on. Off keeps it with `enabled: false`. On takes that key away, so the entry reads
 * as it did before. Every other field, known to hobkin or not, is kept as written.
 */
export function withEnabled(entry: PiServerEntry, on: boolean): PiServerEntry {
  if (!on) return { ...entry, enabled: false }
  if (entry.enabled !== false) return entry
  const { enabled: _enabled, ...rest } = entry
  return rest as PiServerEntry
}

/** The entry the way it sits under `mcpServers` in the file: its name, then its JSON. */
export function entryText(name: string, entry: PiServerEntry): string {
  return `${JSON.stringify(name)}: ${JSON.stringify(entry, null, 2)}`
}
