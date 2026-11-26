import { useCallback, useSyncExternalStore } from 'react'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import type { HobkinConversation } from '#shared/protocol/hobkins.ts'
import { latestWins } from './conversation.ts'

/**
 * What the window keeps of agent pages from one switch to the next (`034-durable-hobkins`, spec 077), so a page opened
 * again shows at once and asks the host only for what changed.
 *
 * Of each durable hobkin opened lately, its page keeps its conversation as last read, what it read of each finished
 * turn's steps and the steps it last had of each, and the turns it draws. The last PAGES_KEPT hobkins' are kept, and
 * every one a page on screen reads. It lives on globalThis, so a hot update keeps it.
 */

/** What a page read of a finished turn from the hobkin's conversation (`activity.before`): the steps right before `joins`, or the turn's newest with null. */
export interface TurnRead {
  joins: string | null
  steps: readonly ActivityEntry[]
}

export interface KeptPage {
  /** The conversation as `hobkin.read` last answered, and the reload key it was asked at (`reloadKey`). */
  conversation: HobkinConversation | null
  readAt: string | null
  /** What was read of each finished turn, by run. */
  reads: Readonly<Record<string, TurnRead>>
  /** Each finished turn's steps as the page last had them all, by run: what it draws of the turn until the host sends them whole again. */
  steps: Readonly<Record<string, readonly ActivityEntry[]>>
  /** The turns the page draws, by run. */
  drawn: readonly string[]
}

/** How many hobkins' pages are kept, besides those on screen. */
export const PAGES_KEPT = 6
/** How many turns' reads and steps a page keeps, the newest kept last. */
export const TURNS_KEPT = 40

const NO_PAGE: KeptPage = { conversation: null, readAt: null, reads: {}, steps: {}, drawn: [] }

interface Keeper {
  /** Each hobkin's page, the one kept last at the end. */
  pages: Map<string, KeptPage>
  /** What reads each hobkin's page now. A page read is never let go. */
  readers: Map<string, Set<() => void>>
  /** Each hobkin's conversation reads, numbered so a late answer never replaces a newer one. Never let go: two numbers each. */
  tickets: Map<string, ReturnType<typeof latestWins>>
  /** Reads on their way, by what they read, so a page mounted again while one is out waits for it. */
  asking: Map<string, Promise<unknown>>
}

const slot = globalThis as { __hobkinPages?: Keeper }
const keeper = (slot.__hobkinPages ??= { pages: new Map(), readers: new Map(), tickets: new Map(), asking: new Map() })

/** A hobkin's page as the window keeps it, empty when it has none. */
export function keptPage(id: string | null): KeptPage {
  return (id && keeper.pages.get(id)) || NO_PAGE
}

/** Only the newest `most` of a turn's record, the newest kept last. The same record when it fits. */
function newestOf<Value>(record: Readonly<Record<string, Value>>, most: number): Readonly<Record<string, Value>> {
  const runs = Object.keys(record)
  return runs.length <= most ? record : Object.fromEntries(runs.slice(-most).map((run) => [run, record[run]!]))
}

/** Changes a hobkin's page, keeps it as the newest, and lets go of the oldest ones nothing reads beyond PAGES_KEPT. */
export function keepPage(id: string, change: (page: KeptPage) => KeptPage): void {
  const before = keptPage(id)
  const next = change(before)
  keeper.pages.delete(id)
  keeper.pages.set(id, next === before ? before : { ...next, reads: newestOf(next.reads, TURNS_KEPT), steps: newestOf(next.steps, TURNS_KEPT) })
  for (const old of keeper.pages.keys()) {
    if (keeper.pages.size <= PAGES_KEPT) break
    if (!keeper.readers.get(old)?.size) keeper.pages.delete(old)
  }
  if (next !== before) for (const reader of keeper.readers.get(id) ?? []) reader()
}

function readPage(id: string, reader: () => void): () => void {
  let readers = keeper.readers.get(id)
  if (!readers) keeper.readers.set(id, (readers = new Set()))
  readers.add(reader)
  return () => {
    readers.delete(reader)
    if (!readers.size) keeper.readers.delete(id)
  }
}

/** A hobkin's page as the window keeps it, drawn again when it changes. */
export function useKeptPage(id: string | null): KeptPage {
  const subscribe = useCallback((reader: () => void) => (id ? readPage(id, reader) : () => {}), [id])
  return useSyncExternalStore(subscribe, () => keptPage(id), () => keptPage(id))
}

/** The numbering of a hobkin's conversation reads (`latestWins`), the same for every page of it. */
export function pageTickets(id: string): ReturnType<typeof latestWins> {
  let tickets = keeper.tickets.get(id)
  if (!tickets) keeper.tickets.set(id, (tickets = latestWins()))
  return tickets
}

/** The read named `key` on its way, or a new one `start` begins: one at a time, whoever asks. */
export function askOnce<Answer>(key: string, start: () => Promise<Answer>): Promise<Answer> {
  const out = keeper.asking.get(key) as Promise<Answer> | undefined
  if (out) return out
  const read = start().finally(() => {
    if (keeper.asking.get(key) === read) keeper.asking.delete(key)
  })
  keeper.asking.set(key, read)
  return read
}
