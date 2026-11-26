import { useEffect, useRef } from 'react'
import { nearRows, type InView } from './windowed-rows.ts'

/**
 * A windowed page's older steps (windowed-list.tsx): those a feed let go, read from the run's saved session. There is no
 * row to press for them: they are read by themselves as the place they go comes near the view.
 */

/** How near the view, in rows, the place the older steps go is when the next page of them is read. */
const NEAR_OLDER = 4

/** Where the older steps go among a page's rows: before `first`, up to `last`, the last of those read so far. -1 with nowhere to go. */
export interface OlderPlace {
  first: number
  last: number
}

/** The older steps' place: before the row at `first`, then on over each row that `read` says is one of them. */
export function olderPlace(rows: readonly { key: string }[], first: number, read: (key: string) => boolean): OlderPlace {
  let last = first
  while (last >= 0 && last + 1 < rows.length && read(rows[last + 1]!.key)) last += 1
  return { first, last }
}

interface Near {
  inView: InView | null
  place: OlderPlace
  /** The saved session may hold older steps, and none are being read. */
  reads: boolean
  /** The oldest step the page has: a page is asked for once for each. */
  oldest: string | null
  loadMore: () => void
  /** Told whether the steps read so far are in view or near it, when a feed that lets steps go asks again (`useOlderSteps`). */
  setNear: (near: boolean) => void
}

/**
 * Reads the next page of older steps as the place they go comes near the view, once for each oldest step: a read that
 * could not be answered is not asked again until the steps move.
 */
export function useOlderNearView({ inView, place, reads, oldest, loadMore, setNear }: Near): void {
  const found = place.first >= 0
  const nearFirst = found && nearRows(inView, place.first, place.first, NEAR_OLDER)
  const nearPages = found && nearRows(inView, place.first, place.last + 1, NEAR_OLDER)
  useEffect(() => setNear(nearPages), [nearPages, setNear])

  const askedBefore = useRef<string | null>(null)
  useEffect(() => {
    if (!nearFirst || !reads || oldest === askedBefore.current) return
    askedBefore.current = oldest
    loadMore()
  }, [nearFirst, reads, oldest, loadMore])
}
