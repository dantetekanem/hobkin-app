import type { DayGroup, Entry } from './conversation.ts'

/**
 * What the conversation's rows are drawn with (`MessageList.tsx`): which entries arrive with movement, and what tells
 * every row the list moved. A reply being written changes its own entry only, so only its row draws again. Pure, so
 * the rules are tested without a window.
 */

const said = new WeakMap<Entry, string>()

/** What an entry says, whatever its key. A reply keeps it when its stored copy takes the place of the one written live. */
export function wordsOf(entry: Entry): string {
  let words = said.get(entry)
  if (words === undefined) {
    words = saying(entry)
    said.set(entry, words)
  }
  return words
}

function saying(entry: Entry): string {
  switch (entry.kind) {
    case 'shell':
      return `shell\n${entry.command}\n${entry.text}`
    case 'message':
      return `${entry.role}\n${entry.text}`
    case 'notice':
      return `${entry.tone}\n${entry.text}`
    case 'schedule':
      return `schedule\n${entry.key}`
  }
}

/** A reply still held live: being written, or finished and waiting for hobkin to store it. Its blocks do the moving. */
export const isLive = (entry: Entry) => entry.key.startsWith('live:')

/** What the last paint showed. Only what is new since then arrives with movement. */
export interface Drawn {
  epoch: number
  keys: Set<string>
  words: Set<string>
}

export function drawnOf(days: readonly DayGroup[], epoch: number): Drawn {
  const entries = days.flatMap((day) => day.entries)
  return { epoch, keys: new Set(entries.map(({ key }) => key)), words: new Set(entries.map(wordsOf)) }
}

/**
 * The entries arriving now, each with its place among them, in the order they are drawn. Nothing arrives in a
 * conversation that was just replaced, and a reply written live, or the stored copy that takes its place, never does.
 */
export function arrivalsOf(days: readonly DayGroup[], epoch: number, before: Drawn | null): Map<string, number> {
  const arriving = new Map<string, number>()
  if (before === null || before.epoch !== epoch) return arriving
  for (const day of days) {
    for (const entry of day.entries) {
      if (!isLive(entry) && !before.keys.has(entry.key) && !before.words.has(wordsOf(entry))) arriving.set(entry.key, arriving.size)
    }
  }
  return arriving
}

/**
 * The days and entries in order, by key. It changes when something arrives, leaves or is replaced, which is when the
 * rows may have moved and measure where they are. A reply growing inside its row leaves it as it was.
 */
export const arrangementOf = (days: readonly DayGroup[]): string => days.map((day) => `${day.key}:${day.entries.map(({ key }) => key).join(',')}`).join('|')
