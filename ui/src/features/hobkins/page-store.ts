import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import type { HobkinConversation } from '#shared/protocol/hobkins.ts'
import { latestWins } from './conversation.ts'

/**
 * What the window keeps of agent pages from one switch to the next (`034-durable-hobkins`, spec 077), so a page opened
 * again shows at once and asks the host only for what changed, and which page shows while the next one gets ready.
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

/** How long the page being left stays while the next one gets ready, at most. */
export const HOLD_MS = 400
/** How many pages left are kept alive, hidden, when the window keeps pages (`keptPagesOn`). */
export const KEPT_PAGES = 2
const KEPT_PAGES_KEY = 'hobkin:kept-pages'

/** The window keeps the last pages left alive: `localStorage['hobkin:kept-pages']` is `on`. Off by default, and wherever storage cannot be read. */
export function keptPagesOn(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEPT_PAGES_KEY) === 'on'
  } catch {
    return false
  }
}

export interface ShownPages {
  /** The agent whose page is on screen. */
  shown: string | null
  /** The pages mounted: those kept hidden, the one left last at the end, then the one on screen. */
  mounted: readonly string[]
  /** The agent asked for, whose page gets ready while the one before stays, or null. */
  preparing: string | null
  /** Says `agent`'s page can show whole: it shows, if it is still the one asked for. */
  ready: (agent: string) => void
}

interface Showing {
  shown: string | null
  /** The pages left that stay mounted, hidden, the one left last at the end. */
  kept: readonly string[]
}

/** Shows `next`, keeping the newest `keep` pages left besides it. */
const show = ({ shown, kept }: Showing, next: string | null, keep: number): Showing => {
  if (next === shown) return { shown, kept }
  const left = [...kept.filter((agent) => agent !== next && agent !== shown), ...(shown ? [shown] : [])]
  return { shown: next, kept: keep > 0 ? left.slice(-keep) : [] }
}

/**
 * Which agent page is on screen, as `asked` changes (the user's call, 2026-11-26: "Wait, then show it whole"). The page
 * being left stays until the one asked for says it is ready (`ready`), or for HOLD_MS at most, and then the next shows.
 * One with nothing to wait for shows at once: none asked for, or a page kept. With `keep`, the newest `keep` pages left
 * stay mounted, hidden, so going back to one is instant. While `frozen`, as when the screen itself leaves, nothing changes.
 */
export function useShownPage(asked: string | null, { keep, frozen }: { keep: number; frozen: boolean }): ShownPages {
  const [showing, setShowing] = useState<Showing>(() => ({ shown: asked, kept: [] }))
  const waiting = !frozen && asked !== showing.shown
  // Nothing to wait for: shown in this same draw.
  if (waiting && (asked === null || showing.kept.includes(asked))) setShowing(show(showing, asked, keep))
  if (!waiting && keep === 0 && showing.kept.length) setShowing({ ...showing, kept: [] })

  useEffect(() => {
    if (!waiting) return
    const timer = setTimeout(() => setShowing((now) => show(now, asked, keep)), HOLD_MS)
    return () => clearTimeout(timer)
  }, [waiting, asked, keep])

  const ready = useCallback(
    (agent: string) => setShowing((now) => (agent === asked && agent !== now.shown ? show(now, agent, keep) : now)),
    [asked, keep],
  )
  const mounted = showing.shown ? [...showing.kept, showing.shown] : showing.kept
  return { shown: showing.shown, mounted, preparing: waiting ? asked : null, ready }
}
