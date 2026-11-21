import type { ActivityEntry } from '#shared/protocol/activity.ts'

/**
 * A tool's output that the feed cut to its first and last parts, with a marker between (`ActivityEntry.outputLength`):
 * how the step view says it, before and while it reads the whole from the run's saved session. Pure, so the words are
 * tested without a window.
 */

/** How long a cut output is in all, or null when the feed holds it whole. */
export const cutOf = (entry: ActivityEntry | undefined): number | null => entry?.outputLength ?? null

const KB = 1024

/** A size as the step view says it: 9.6 KB, 48 KB, 3.2 MB. */
export function sizeOf(length: number): string {
  if (length >= KB * KB) return `${(length / (KB * KB)).toFixed(1)} MB`
  const kb = length / KB
  return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
}

/** Where a cut output's whole text stands: not read yet, being read, or in no saved session to read it from. */
export type CutState = 'cut' | 'reading' | 'unsaved'

/** What a cut output's button says, or, with no saved session to read it from, its size alone. */
export function cutWords(length: number, state: CutState): string {
  const size = sizeOf(length)
  if (state === 'cut') return `Show all ${size}`
  if (state === 'reading') return `Reading all ${size}…`
  return `${size} in all`
}
