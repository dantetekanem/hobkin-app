import { useEffect, useMemo, useRef, useState } from 'react'
import { FEED_STEPS, type ActivityEntry, type JobActivity } from '#shared/protocol/activity.ts'
import { entryTimeOf, type EntryTime } from '@/features/agent-activity/use-agent-activity.ts'
import { watchJob } from '@/lib/host/client.ts'
import { keepEachEqual } from '@/lib/host/frame.ts'
import { runCommand, useHasHost, useHost, useHostKept, type HostState } from '@/lib/host/index.ts'
import type { TurnActivity } from './conversation.ts'

/**
 * The steps of a durable hobkin's turns that are over, for its page (`034-durable-hobkins`): what the host still holds of
 * each turn's run, after what was read from the hobkin's conversation for the steps it holds none of (`activity.before`,
 * which reads only that turn's part of it). The host keeps a finished turn's steps for a while, and its newest 200 at most.
 */

type Feed = readonly ActivityEntry[] | undefined

/** What the page read of a turn from the hobkin's conversation: the steps right before `joins`, or the turn's newest with null. */
interface Read {
  joins: string | null
  steps: readonly ActivityEntry[]
}

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

const timeReaders = new Map<string, (id: string) => EntryTime | undefined>()

/** When this window first saw each of a turn's steps, one reader for each run, so a step drawn with it stays the same. */
export function timeOfTurn(run: string): (id: string) => EntryTime | undefined {
  let read = timeReaders.get(run)
  if (!read) timeReaders.set(run, (read = (id) => entryTimeOf(run, id)))
  return read
}

/**
 * The steps of each of `runs`, the turns whose steps the page draws, by run, while it is mounted. Each is watched, so the
 * host sends its whole steps, and each the host holds too few of is read once from the conversation, again only when the
 * host lets go of what the read joined. The turn in flight, `live`, is watched and not read: its page reads its own. A
 * turn the host cannot read for, as one on Claude Code or a host from before, has only what the host holds.
 */
export function useTurnSteps(runs: readonly string[], { live, cwd }: { live: string | null; cwd?: string }): Readonly<Record<string, TurnActivity>> {
  const hosted = useHasHost()
  const open = useHost((state) => state.link === 'open')
  const key = runs.join('\n')
  useEffect(() => {
    if (!key) return
    const letGo = key.split('\n').map((run) => watchJob(run))
    return () => {
      for (const stop of letGo) stop()
    }
  }, [key])

  const feeds = useHostKept((state) => runs.map((run) => heldFeed(state, run)), sameFeeds)
  const [reads, setReads] = useState<Readonly<Record<string, Read>>>({})
  const asking = useRef(new Set<string>())
  useEffect(() => {
    if (!hosted || !open) return
    runs.forEach((run, index) => {
      const feed = feeds[index]
      const joins = joinsOf(feed)
      const asked = `${run}\n${joins}`
      if (run === live || joins === undefined || reads[run]?.joins === joins || asking.current.has(asked)) return

      asking.current.add(asked)
      const oldest = joins === null ? undefined : feed![0]!
      const before = oldest ? { before: oldest.id, ...(oldest.at === undefined ? {} : { at: oldest.at }) } : {}
      void runCommand('activity.before', { job: run, ...before }).then(
        (page) => {
          asking.current.delete(asked)
          setReads((all) => ({ ...all, [run]: { joins, steps: page.steps } }))
        },
        (error: unknown) => {
          asking.current.delete(asked)
          // Asked again once the host is back. Anything else it cannot read stays as the host holds it.
          if ((error as { code?: string } | null)?.code !== 'disconnected') setReads((all) => ({ ...all, [run]: { joins, steps: NO_ENTRIES } }))
        },
      )
    })
  }, [hosted, open, runs, feeds, reads, live])

  return useMemo(() => {
    const steps: Record<string, TurnActivity> = {}
    runs.forEach((run, index) => {
      const feed = feeds[index] ?? NO_ENTRIES
      const read = reads[run]
      const joined = read && read.joins === joinsOf(feeds[index]) ? read.steps : NO_ENTRIES
      // A step the host holds is not drawn twice.
      const held = new Set(feed.map(({ id }) => id))
      const before = joined.some(({ id }) => held.has(id)) ? joined.filter(({ id }) => !held.has(id)) : joined
      const entries = before.length && feed.length ? [...before, ...feed] : before.length ? before : feed
      if (!entries.length) return

      const timeOf = timeOfTurn(run)
      steps[run] = { entries, ...(cwd ? { cwd } : {}), seenAt: (id) => timeOf(id)?.seen }
    })
    return steps
  }, [runs, feeds, reads, cwd])
}
