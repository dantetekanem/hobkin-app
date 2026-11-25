import { useEffect, useMemo, useRef, useState } from 'react'
import { runningAgents } from '@/app/running-agents.ts'
import { listedAgents } from '@/features/hobkins/list.ts'
import { useSettings } from '@/features/settings/store.ts'
import { followReviewList } from '@/features/work/review-list-follow.ts'
import { SAMPLE_REVIEW_LIST } from '@/features/work/sample-reviews.ts'
import { keepEachEqual, sameAgentsQuietly } from '@/lib/host/frame.ts'
import { runCommand, useHasHost, useHost, useListHostKept } from '@/lib/host/index.ts'
import { atWorkOf, keepSections, reviewsOf, type AgentLike, type AgentRow, type ProjectPage, type ProjectReviews } from './model.ts'
import { askForGuide, type GuideRead, type GuideSaid } from './run-guide.ts'
import { sampleGuideAsked, sampleRunGuide } from './sample.ts'

/** How a project's page reads what changes on its own clock: its agents, its AI reviews and its run guide. */

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

/** How often a guide whose look waits or runs is read again, until it is done. */
const GUIDE_AGAIN_MS = 5_000

/** The run guide's button as the page and Try it press it: under way, what hobkin said to the last press, and the press. */
export interface GuideControl {
  pressing: boolean
  said: GuideSaid | null
  press: () => void
}

const READING: GuideRead = { state: 'reading' }
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * A code project's run guide (`work.guide.read`), read while `wanted`, again after each press, and every five seconds
 * while its guide look waits or runs. The press files the look (`work.guide.write`) and keeps hobkin's line or refusal.
 * What was read for another host or project is not this one's. Without a host, the sample's, where a press marks it queued.
 */
export function useRunGuide(live: boolean, slug: string, wanted: boolean): { read: GuideRead; control: GuideControl } {
  const home = useHost((state) => state.home)
  const [held, setHeld] = useState<{ home: string | null; slug: string; said: string; read: GuideRead } | null>(null)
  const [turn, setTurn] = useState(0)
  const [press, setPress] = useState<{ home: string | null; slug: string; pressing: boolean; said: GuideSaid | null } | null>(null)
  const [sampleQueued, setSampleQueued] = useState<string | null>(null)

  useEffect(() => {
    if (!live || !wanted) return
    let current = true
    const keep = (read: GuideRead) => {
      if (!current) return
      const said = JSON.stringify(read)
      setHeld((before) => (before?.home === home && before.slug === slug && before.said === said ? before : { home, slug, said, read }))
    }
    runCommand('work.guide.read', { slug }).then(
      (guide) => keep({ state: 'read', guide }),
      (error: unknown) => keep({ state: 'failed', error: messageOf(error) }),
    )
    return () => {
      current = false
    }
  }, [live, wanted, home, slug, turn])

  const sample = useMemo<GuideRead | null>(() => {
    if (live) return null
    const guide = sampleRunGuide(slug, Date.now())
    return { state: 'read', guide: sampleQueued === slug ? { ...guide, pending: 'queued' } : guide }
  }, [live, slug, sampleQueued])
  const read = sample ?? (held && held.home === home && held.slug === slug ? held.read : READING)

  const waits = live && read.state === 'read' && read.guide.pending !== null
  useEffect(() => {
    if (!waits) return
    const timer = setTimeout(() => setTurn((count) => count + 1), GUIDE_AGAIN_MS)
    return () => clearTimeout(timer)
  }, [waits, turn])

  const ours = press && press.home === home && press.slug === slug ? press : null
  const pressing = Boolean(ours?.pressing)
  const control = useMemo<GuideControl>(
    () => ({
      pressing,
      said: ours?.said ?? null,
      press: () => {
        if (pressing) return
        setPress({ home, slug, pressing: true, said: null })
        const write = live
          ? () => runCommand('work.guide.write', { slug })
          : async () => {
              setSampleQueued(slug)
              return { message: sampleGuideAsked(slug) }
            }
        void askForGuide(write).then((said) => {
          setPress({ home, slug, pressing: false, said })
          setTurn((count) => count + 1)
        })
      },
    }),
    [pressing, ours?.said, home, slug, live],
  )
  return { read, control }
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
