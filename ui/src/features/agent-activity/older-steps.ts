import { useCallback, useEffect, useMemo } from 'react'
import { useStore } from 'zustand'
import { FEED_STEPS, type ActivityEntry, type JobActivity } from '#shared/protocol/activity.ts'
import { onWatchedChange, runCommand, useHost } from '@/lib/host/index.ts'
import { OlderSteps, type OlderPages } from './older-pages.ts'

/** The window's one keeper of older steps. A job's pages go once nothing on screen watches it. */
const older = new OlderSteps({
  before: (args) => runCommand('activity.before', args),
  output: (args) => runCommand('activity.output', args),
})
const stopKeeping = onWatchedChange((jobs) => older.keepOnly(jobs))
import.meta.hot?.dispose(stopKeeping)

const NOTHING: OlderPages = { steps: [], more: null, loading: false }

/**
 * Whether a feed may have let older steps go: it holds as many as hobkin keeps. A run's page offers to load earlier
 * steps while `more` is true, or still null with a feed this long.
 */
export const mayHaveOlder = (feed: readonly ActivityEntry[] | undefined): boolean => (feed?.length ?? 0) >= FEED_STEPS

/**
 * The steps a watched job's feed let go, read from its run's saved session a page at a time by `loadMore`: oldest
 * first, ending right before the feed's oldest step, again after the feed lets more go. `more` is null until the
 * host first answers, and false from a host from before these steps, which shows no error.
 */
export function useOlderSteps(job: string | null): OlderPages & { loadMore: () => void } {
  const feed = useHost((state) => (job ? (state.snapshot.jobActivity as JobActivity | undefined)?.[job] : undefined))
  const held = useStore(older.store, (jobs) => (job ? jobs[job] : undefined))
  useEffect(() => {
    if (job && feed) void older.follow(job, feed)
  }, [job, feed])
  const loadMore = useCallback(() => {
    if (job && feed) void older.loadMore(job, feed)
  }, [job, feed])

  return useMemo(() => {
    const { steps, more, loading } = held ?? NOTHING
    // While the pages wait to join a feed that moved on, a step the feed holds is not shown twice.
    const shown = new Set(feed?.map(({ id }) => id))
    const once = steps.some(({ id }) => shown.has(id)) ? steps.filter(({ id }) => !shown.has(id)) : steps
    return { steps: once, more, loading, loadMore }
  }, [held, feed, loadMore])
}

/** A tool step's whole output, read from its run's saved session, for a step whose feed keeps only its ends (`outputLength`). Null when there is none, as from a host from before. */
export const wholeOutput = (job: string, id: string): Promise<string | null> => older.wholeOutput(job, id)
