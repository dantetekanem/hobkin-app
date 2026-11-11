/**
 * Notes hobkin left on the host reach the window's own log. A note the window already knows, or removed, stays as
 * the window has it: the window's log is what the reviewer did.
 */
import type { NoteEntry } from './notes.ts'

export function mergeHostNotes(local: readonly NoteEntry[], host: readonly NoteEntry[]): readonly NoteEntry[] {
  const known = new Set(local.map((entry) => (entry.op === 'put' ? entry.note.id : entry.id)))
  const arrived = host.filter((entry): entry is Extract<NoteEntry, { op: 'put' }> => entry.op === 'put' && !known.has(entry.note.id))
  return arrived.length === 0 ? local : [...local, ...arrived]
}
