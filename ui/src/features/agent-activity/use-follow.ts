import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { followEnd, type FollowControl } from './follow.ts'

export interface Follow {
  /** The element that scrolls. */
  scroller: RefObject<HTMLDivElement | null>
  /** The list inside it, watched for growth. */
  content: RefObject<HTMLOListElement | null>
  /** True while the view follows the newest step. */
  pinned: boolean
  /** Goes to the newest step and follows it again. */
  jumpToLatest: () => void
  onScroll: () => void
}

/**
 * Keeps an agent's exchange at its newest step while it grows, unless the user scrolled up to read (follow.ts). It goes
 * to the end at once, at most once a frame, when the page has laid out what changed. Nothing glides, and nothing is
 * read of the page while it draws.
 */
export function useFollow(): Follow {
  const scroller = useRef<HTMLDivElement | null>(null)
  const content = useRef<HTMLOListElement | null>(null)
  const control = useRef<FollowControl | null>(null)
  const [pinned, setPinned] = useState(true)

  // It opens at the newest step: no scrolling to watch.
  useLayoutEffect(() => {
    const element = scroller.current
    const list = content.current
    if (!element || !list) return
    const follow = followEnd(element, list, { page: window, Observer: ResizeObserver, onPinned: setPinned })
    control.current = follow
    return () => {
      follow.dispose()
      if (control.current === follow) control.current = null
    }
  }, [])

  const onScroll = useCallback(() => control.current?.onScroll(), [])
  const jumpToLatest = useCallback(() => control.current?.jumpToLatest(), [])

  return { scroller, content, pinned, jumpToLatest, onScroll }
}
