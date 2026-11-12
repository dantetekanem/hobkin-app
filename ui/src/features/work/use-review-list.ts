import { useEffect, useState } from 'react'
import type { ReviewList } from '#shared/review/status.ts'
import { runCommand, useHost } from '@/lib/host/index.ts'
import { followReviewList } from './review-list-follow.ts'
import { SAMPLE_REVIEW_LIST } from './sample-reviews.ts'

export interface ReviewListView {
  /** Null until the host first answers. */
  list: ReviewList | null
  /** Why the last ask failed. The list from before stays. */
  error: string | null
}

const SAMPLE: ReviewListView = { list: SAMPLE_REVIEW_LIST, error: null }
const WAITING: ReviewListView = { list: null, error: null }

/**
 * Every AI review the host knows, followed while the screen is open (`review-list-follow.ts`), and asked anew from
 * another host. Without a host, the sample.
 */
export function useReviewList(live: boolean): ReviewListView {
  const home = useHost((state) => state.home)
  const [view, setView] = useState<ReviewListView>(WAITING)

  useEffect(() => {
    if (!live) return
    setView(WAITING)
    const follow = followReviewList({
      run: () => runCommand('review.list'),
      onList: (list) => setView({ list, error: null }),
      onError: (error) => setView((shown) => ({ ...shown, error })),
    })
    return () => follow.stop()
  }, [live, home])

  return live ? view : SAMPLE
}
