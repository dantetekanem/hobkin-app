import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReviewList } from '#shared/review/status.ts'
import { runCommand, useHost } from '@/lib/host/index.ts'
import { followReviewList, type ReviewListFollow } from './review-list-follow.ts'
import { SAMPLE_REVIEW_LIST } from './sample-reviews.ts'

export interface ReviewListView {
  /** Null until the host first answers. */
  list: ReviewList | null
  /** Why the last ask failed. The list from before stays. */
  error: string | null
  /** Reads the list now, as after a review was started again. Nothing to do without a host. */
  refresh: () => void
}

type Shown = Pick<ReviewListView, 'list' | 'error'>

const SAMPLE: Shown = { list: SAMPLE_REVIEW_LIST, error: null }
const WAITING: Shown = { list: null, error: null }

/**
 * Every AI review the host knows, followed while the screen is open (`review-list-follow.ts`), and asked anew from
 * another host. Without a host, the sample.
 */
export function useReviewList(live: boolean): ReviewListView {
  const home = useHost((state) => state.home)
  const [view, setView] = useState<Shown>(WAITING)
  const following = useRef<ReviewListFollow | null>(null)
  const refresh = useCallback(() => following.current?.askNow(), [])

  useEffect(() => {
    if (!live) return
    setView(WAITING)
    const follow = followReviewList({
      run: () => runCommand('review.list'),
      onList: (list) => setView({ list, error: null }),
      onError: (error) => setView((shown) => ({ ...shown, error })),
    })
    following.current = follow
    return () => {
      follow.stop()
      if (following.current === follow) following.current = null
    }
  }, [live, home])

  return { ...(live ? view : SAMPLE), refresh }
}
