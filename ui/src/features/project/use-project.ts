import { useEffect, useMemo, useRef, useState } from 'react'
import { runningAgents } from '@/app/running-agents.ts'
import { listedAgents } from '@/features/hobkins/list.ts'
import { useSettings } from '@/features/settings/store.ts'
import { followReviewList } from '@/features/work/review-list-follow.ts'
import { SAMPLE_REVIEW_LIST } from '@/features/work/sample-reviews.ts'
import { keepEachEqual, sameAgentsQuietly } from '@/lib/host/frame.ts'
import { runCommand, useHasHost, useHost, useListHostKept } from '@/lib/host/index.ts'
import { atWorkOf, keepSections, reviewsOf, type AgentLike, type AgentRow, type ProjectPage, type ProjectReviews } from './model.ts'

/** How a project's page reads what changes on its own clock: its agents and its AI reviews. */

const NO_AGENTS: AgentLike[] = []

/**
 * This project's work agents, the ones waiting for the user first. The selection is this project's agents alone, each
 * kept while it says the same apart from its latest words, so another project's agent, or a word streamed here, draws
 * nothing again. Without a host, the frame's sample agents.
 */
export function useProjectAgents(slug: string): AgentRow[] {
  const live = useHasHost()
  const hosted = useListHostKept(
    (state) => (live ? (listedAgents(state.snapshot) as AgentLike[]).filter((agent) => agent.kind === 'work' && agent.project === slug) : NO_AGENTS),
    (held, next) => keepEachEqual(held, next, sameAgentsQuietly) as AgentLike[],
  )
  // The sample shows as many agents as Settings allows, so its rows are read again when that number changes.
  const limit = useSettings((state) => state.agents)
  return useMemo(() => atWorkOf(live ? hosted : runningAgents(), slug), [live, hosted, limit, slug])
}

/**
 * This project's AI reviews, followed from the host's list (`review.list`) while the page shows. The page draws again
 * only when what this project's part of the list says changed, not on every read of it. Without a host, the sample's.
 */
export function useProjectReviews(live: boolean, slug: string): ProjectReviews | null {
  const home = useHost((state) => state.home)
  const [held, setHeld] = useState<{ home: string | null; slug: string; said: string; reviews: ProjectReviews } | null>(null)

  useEffect(() => {
    if (!live) return
    const follow = followReviewList({
      run: () => runCommand('review.list'),
      onList: (list) => {
        const reviews = reviewsOf(list, slug)
        const said = JSON.stringify(reviews)
        setHeld((before) => {
          const sameAsBefore = before?.home === home && before.slug === slug && before.said === said
          return sameAsBefore ? before : { home, slug, said, reviews }
        })
      },
      // What was read before stays, and the next turn asks again.
      onError: () => {},
    })
    return () => follow.stop()
  }, [live, home, slug])

  const sample = useMemo(() => (live ? null : reviewsOf(SAMPLE_REVIEW_LIST, slug)), [live, slug])
  // What was read for another host or another project is not this page's.
  const followed = held && held.home === home && held.slug === slug ? held.reviews : null
  return sample ?? followed
}

/** Keeps the sections of `page` that say the same as the page last drawn. */
export function useKeptPage(page: ProjectPage): ProjectPage {
  const drawn = useRef(page)
  const kept = keepSections(drawn.current, page)
  useEffect(() => {
    drawn.current = kept
  })
  return kept
}
