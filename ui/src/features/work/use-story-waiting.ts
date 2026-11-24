import { useRef } from 'react'
import { rowsOf } from './ai-reviews.ts'
import { waitingRows } from './review-story.ts'
import { useStory } from './story-store.ts'
import { useReviewList } from './use-review-list.ts'

/**
 * Whether a review of the story is gone, as the review list says now: it is no longer waiting on the user. The list is
 * followed only while a story runs, and until it answers nothing is taken for gone.
 */
export function useStoryGone(live: boolean): (id: string) => boolean {
  const running = useStory((state) => state.story !== null)
  const { list } = useReviewList(live && running)
  const waiting = useRef<ReadonlySet<string> | null>(null)
  waiting.current = running && live && list ? new Set(waitingRows(rowsOf(list)).map((row) => row.item.id)) : null
  return (id) => waiting.current != null && !waiting.current.has(id)
}
