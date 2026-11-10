import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** How close to the end still counts as being at the end, in pixels. */
const SLACK = 48

export interface PinnedScroll {
  /** The element that scrolls. */
  scroller: RefObject<HTMLDivElement | null>
  /** The content inside it, watched for growth. */
  content: RefObject<HTMLOListElement | null>
  /** True while the view follows the newest message. */
  pinned: boolean
  /** Goes to the newest message and follows it again. */
  jumpToLatest: () => void
  /** Goes to the newest message if the view is following. Called as content is drawn, before the browser paints. */
  stick: () => void
  /** Moves by part of a screen, for keys pressed in the input. */
  scrollByPage: (direction: 1 | -1) => void
  onScroll: () => void
}

/**
 * Keeps a conversation at its newest message while it grows, unless the user scrolled up to read.
 * It opens at the newest message, and a reply growing word by word is followed without a jump.
 */
export function usePinnedScroll(): PinnedScroll {
  const scroller = useRef<HTMLDivElement | null>(null)
  const content = useRef<HTMLOListElement | null>(null)
  const following = useRef(true)
  const [pinned, setPinned] = useState(true)

  const toEnd = useCallback(() => {
    const element = scroller.current
    if (element) element.scrollTop = element.scrollHeight
  }, [])

  // Every change in the content's height: a new message, a growing reply, an image that loaded.
  useLayoutEffect(() => {
    const list = content.current
    if (!list) return
    toEnd()
    const observer = new ResizeObserver(() => {
      if (following.current) toEnd()
    })
    observer.observe(list)
    return () => observer.disconnect()
  }, [toEnd])

  const lastTop = useRef(0)
  const onScroll = useCallback(() => {
    const element = scroller.current
    if (!element) return
    const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight <= SLACK
    // Only moving up, away from the end, stops the following. A message on its way in is drawn below its
    // place for a moment, which makes the content look longer than it is, and that must not count as scrolling away.
    if (atEnd) following.current = true
    else if (element.scrollTop < lastTop.current) following.current = false
    lastTop.current = element.scrollTop
    setPinned(following.current)
  }, [])

  const jumpToLatest = useCallback(() => {
    following.current = true
    setPinned(true)
    toEnd()
  }, [toEnd])

  const scrollByPage = useCallback((direction: 1 | -1) => {
    const element = scroller.current
    element?.scrollBy({ top: direction * element.clientHeight * 0.8 })
  }, [])

  const stick = useCallback(() => {
    if (following.current) toEnd()
  }, [toEnd])

  return { scroller, content, pinned, jumpToLatest, stick, scrollByPage, onScroll }
}
