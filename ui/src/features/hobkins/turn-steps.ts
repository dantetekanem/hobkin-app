import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react'
import { FEED_STEPS, sameEntry, type ActivityEntry, type JobActivity } from '#shared/protocol/activity.ts'
import { entryTimeOf, type EntryTime } from '@/features/agent-activity/use-agent-activity.ts'
import { hostStore, onWatchedChange, watchJob } from '@/lib/host/client.ts'
import { keepEachEqual } from '@/lib/host/frame.ts'
import { runCommand, useHasHost, useHost, useHostKept, type HostState } from '@/lib/host/index.ts'
import { drawNext, withDrawnTurns, type ShownTurn, type TurnActivity } from './conversation.ts'
import { askOnce, keepPage, useKeptPage, type TurnRead } from './page-store.ts'

/**
 * The steps of a durable hobkin's turns that are over, for its page (`034-durable-hobkins`): what the host still holds of
 * each turn's run, after what was read from the hobkin's conversation for the steps it holds none of (`activity.before`,
 * which reads only that turn's part of it). The host keeps a finished turn's steps for a while, and its newest 200 at most.
 * The page draws its turns newest first (`useNewestFirst`), and what it read and had of each is kept with it (`page-store.ts`).
 */

type Feed = readonly ActivityEntry[] | undefined

const NO_ENTRIES: readonly ActivityEntry[] = []

const heldFeed = (state: HostState, run: string): Feed => {
  const steps = (state.snapshot.jobActivity as JobActivity | undefined)?.[run]
  return Array.isArray(steps) ? steps : undefined
}

const sameFeeds = (held: readonly Feed[], next: readonly Feed[]) => keepEachEqual(held, next, Object.is)

/**
 * What a turn's read joins: the newest of the turn when the host holds none of it, the steps before its oldest when the
 * host holds as many as a feed keeps, so it may have let older ones go, and undefined when the host holds the whole turn.
 */
function joinsOf(feed: Feed): string | null | undefined {
  if (!feed?.length) return null
  return feed.length >= FEED_STEPS ? feed[0]!.id : undefined
}

/**
 * A turn's steps from the hobkin's conversation: the ones right before `oldest`, the host's oldest step of it, or its
 * newest with none. None when the host cannot read them, as for a turn on Claude Code, and null when the connection
 * went, so the page asks again once the host is back.
 */
async function readTurn(run: string, oldest: ActivityEntry | undefined): Promise<readonly ActivityEntry[] | null> {
  const before = oldest ? { before: oldest.id, ...(oldest.at === undefined ? {} : { at: oldest.at }) } : {}
  try {
    const page = await runCommand('activity.before', { job: run, ...before })
    return page.steps
  } catch (error) {
    return (error as { code?: string } | null)?.code === 'disconnected' ? null : NO_ENTRIES
  }
}

/** A turn's steps: what was read before what the host holds, while it still joins it, then what the host holds, each step once. */
function turnEntries(feed: Feed, read: TurnRead | undefined): readonly ActivityEntry[] {
  const held = feed ?? NO_ENTRIES
  const joined = read && read.joins === joinsOf(feed) ? read.steps : NO_ENTRIES
  if (!held.length) return joined

  const heldIds = new Set(held.map(({ id }) => id))
  const before = joined.filter(({ id }) => !heldIds.has(id))
  return before.length ? [...before, ...held] : held
}

const timeReaders = new Map<string, (id: string) => EntryTime | undefined>()

/** When this window first saw each of a turn's steps, one reader for each run, so a step drawn with it stays the same. */
export function timeOfTurn(run: string): (id: string) => EntryTime | undefined {
  let read = timeReaders.get(run)
  if (!read) timeReaders.set(run, (read = (id) => entryTimeOf(run, id)))
  return read
}

/**
 * Which watched jobs the window holds whole. A host that takes watching sends a job's tail until it is told the window
 * watches it, and then its whole steps (`watch.ts`): a job is held whole from the first change to its steps after the
 * window began to watch it, or after the host, connecting, said all it holds. Kept on globalThis, so a hot update keeps
 * what it has seen.
 */
interface WholeFeeds {
  /** Each job watched, with the steps held of it when the window began to wait for them, or true once they came. */
  jobs: Map<string, Feed | true>
  /** The jobs watched now, until the batch of changes that made them is over, or null. */
  next: readonly string[] | null
}

function followFeeds(): WholeFeeds {
  const feeds: WholeFeeds = { jobs: new Map(), next: null }
  // Once the batch is over, when the host is told (`followWatching`): the jobs that came wait for their steps from here.
  const settle = () => {
    const watched = new Set(feeds.next)
    feeds.next = null
    for (const job of feeds.jobs.keys()) if (!watched.has(job)) feeds.jobs.delete(job)
    const state = hostStore.getState()
    for (const job of watched) if (!feeds.jobs.has(job)) feeds.jobs.set(job, heldFeed(state, job))
  }
  onWatchedChange((jobs) => {
    if (feeds.next === null) queueMicrotask(settle)
    feeds.next = jobs
  })
  hostStore.subscribe((state, before) => {
    if (!state.snapshotReady) return
    // A host that connected said all it holds: what it sends of each job after this is its answer to being told.
    const connected = !before.snapshotReady
    if (!connected && state.snapshot.jobActivity === before.snapshot.jobActivity) return
    for (const [job, since] of feeds.jobs) {
      if (connected) feeds.jobs.set(job, heldFeed(state, job))
      else if (since !== true && heldFeed(state, job) !== since) feeds.jobs.set(job, true)
    }
  })
  return feeds
}

const feedsSlot = globalThis as { __hobkinWholeFeeds?: WholeFeeds }
const wholeFeeds = (feedsSlot.__hobkinWholeFeeds ??= followFeeds())

/** The window holds `job`'s whole steps: it watches it and the host has sent them, or the host sends every job whole. */
export const fedWhole = (state: HostState, job: string): boolean => !state.watching || wholeFeeds.jobs.get(job) === true

/** Holds every one of `jobs` watched while the part is mounted, so a host that takes watching sends their whole steps. */
export function useHeldJobs(jobs: readonly string[]): void {
  const key = jobs.join('\n')
  useEffect(() => {
    if (!key) return
    const letGo = key.split('\n').map((job) => watchJob(job))
    return () => {
      for (const stop of letGo) stop()
    }
  }, [key])
}

/** Holds `jobs` watched, and says whether the window holds the whole steps of each the host holds anything of. */
export function useWholeJobs(jobs: readonly string[]): boolean {
  useHeldJobs(jobs)
  return useHost((state) => jobs.every((job) => !heldFeed(state, job)?.length || fedWhole(state, job)))
}

const sameFlags = (held: readonly boolean[], next: readonly boolean[]) => keepEachEqual(held, next, Object.is)

export interface DrawnSteps {
  /** The steps the page has of each turn, by run. The turn in flight's page reads its own. */
  finished: Readonly<Record<string, TurnActivity>>
  /** The page has all the steps of the turn it will draw: nothing drawn of it now gives way when the rest comes. */
  known: (run: string) => boolean
}

/**
 * The steps of each of `runs`, the turns a durable hobkin's page draws, by run, while it is mounted. Each is watched, so
 * the host sends its whole steps, and each the host holds too few of is read once from the conversation, again only when
 * the host lets go of what the read joined. The turn in flight, `live`, is watched and not read: its page reads its own.
 * A turn the host cannot read for, as one on Claude Code or a host from before, has only what the host holds.
 *
 * A finished turn's steps the page had all of are kept with its page (`page-store.ts`), so a page opened again draws
 * them at once, before the host sends them whole again. A turn is `known` once its steps are all there: the host's
 * whole ones, with what was read before them when the host holds as many as a feed keeps, or what was read when the
 * host holds none, or the steps kept. The one in flight once the host sends its whole steps, or holds none.
 */
export function useDrawnSteps(id: string, runs: readonly string[], { live, cwd }: { live: string | null; cwd?: string }): DrawnSteps {
  const hosted = useHasHost()
  const open = useHost((state) => state.link === 'open')
  useHeldJobs(runs)
  const feeds = useHostKept((state) => runs.map((run) => heldFeed(state, run)), sameFeeds)
  const whole = useHostKept((state) => runs.map((run) => fedWhole(state, run)), sameFlags)
  const page = useKeptPage(id)
  const { reads, steps: kept } = page

  useEffect(() => {
    if (!hosted || !open) return
    runs.forEach((run, index) => {
      const feed = feeds[index]
      const joins = joinsOf(feed)
      if (run === live || joins === undefined || reads[run]?.joins === joins) return

      void askOnce(`turn\n${run}\n${joins}`, () => readTurn(run, joins === null ? undefined : feed?.[0])).then((steps) => {
        if (steps) keepPage(id, (held) => (held.reads[run]?.joins === joins ? held : { ...held, reads: { ...held.reads, [run]: { joins, steps } } }))
      })
    })
  }, [id, hosted, open, runs, feeds, reads, live])

  const drawn = useMemo(() => {
    const connected = hosted && open
    const finished: Record<string, TurnActivity> = {}
    const known = new Set<string>()
    /** Turns whose steps are all here now, from the host and the reads, to keep with the page. */
    const complete = new Set<string>()
    runs.forEach((run, index) => {
      const feed = feeds[index]
      const read = reads[run]
      const all = feed?.length ? whole[index]! && (feed.length < FEED_STEPS || read?.joins === feed[0]!.id) : read?.joins === null
      const turnKept = run === live ? undefined : kept[run]
      const entries = connected && all ? keepEachEqual(turnKept, turnEntries(feed, read), sameEntry) : (turnKept ?? turnEntries(feed, read))
      if (run === live ? !connected || !feed?.length || whole[index] : !connected || all || turnKept) known.add(run)
      if (connected && all && run !== live && entries.length) complete.add(run)
      if (!entries.length) return

      const timeOf = timeOfTurn(run)
      finished[run] = { entries, ...(cwd ? { cwd } : {}), seenAt: (id) => timeOf(id)?.seen }
    })
    return { finished, known, complete }
  }, [hosted, open, runs, feeds, whole, reads, kept, live, cwd])

  // What the page has all of a finished turn's steps is kept with it.
  useEffect(() => {
    const fresh = [...drawn.complete].filter((run) => kept[run] !== drawn.finished[run]!.entries)
    if (!fresh.length) return
    keepPage(id, (held) => ({ ...held, steps: { ...held.steps, ...Object.fromEntries(fresh.map((run) => [run, drawn.finished[run]!.entries])) } }))
  }, [id, drawn, kept])

  return useMemo(() => ({ finished: drawn.finished, known: (run: string) => drawn.known.has(run) }), [drawn])
}

const sameRuns = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((run, index) => run === right[index])

interface NewestFirst {
  turns: readonly ShownTurn[]
  rows: readonly object[]
  known: (run: string) => boolean
  /** The rows shown now, once they are drawn: their turns are drawn too (`withDrawnTurns`). Null for a page not drawn yet. */
  shown: readonly object[] | null
  /** How many rows the page draws from the newest up. */
  window: number
}

/**
 * Draws a page's turns newest first (`drawNext`): adds the next one to `draw` while the turns drawn, `runs`, are known
 * and their rows do not fill `window`, so a page watches and reads only the turns that reach its newest rows. Once that
 * is settled, the turns of every row shown are drawn too, as more rows show. The turns drawn are kept with the page, for
 * whatever holds its watches while it is hidden. True once settled.
 */
export function useNewestFirst(id: string, runs: readonly string[], draw: Dispatch<SetStateAction<readonly string[]>>, { turns, rows, known, shown, window }: NewestFirst): boolean {
  const { next, settled } = drawNext(runs, { turns, rows, known, window })
  useEffect(() => {
    if (next) draw((held) => (held.includes(next) ? held : [...held, next]))
  }, [next, draw])
  useEffect(() => {
    if (settled && shown) draw((held) => withDrawnTurns(held, shown))
  }, [settled, shown, draw])
  useEffect(() => keepPage(id, (page) => (sameRuns(page.drawn, runs) ? page : { ...page, drawn: runs })), [id, runs])
  return settled
}
