import { useState } from 'react'
import { useView } from '../../app/view-store.ts'

/**
 * The review the review screen shows: the open one, and once none is open, the last one it showed. Closing a review
 * clears the open one at once, while its screen is still sliding away; that screen keeps showing its own review to the
 * end instead of turning into the sample, whose graph and nodes flashed on the way out (the user, 2026-11-27). Null when
 * the screen opened with no review.
 */
export function useShownReview(): string | null {
  const open = useView((view) => view.openReview)
  const [lastOpen, setLastOpen] = useState(open)

  if (open != null && open !== lastOpen) {
    setLastOpen(open)
  }

  return open ?? lastOpen
}
