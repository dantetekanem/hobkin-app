import { animate, type AnimationPlaybackControls } from 'motion/react'
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useStill } from '@/app/still.ts'
import { spring } from '@/lib/motion.ts'

/** How close to the end still counts as being at the end, in pixels. */
const SLACK = 48

/** How far the list is drawn below its place while it glides up into it. Zero at rest. */
const liftOf = (list: HTMLElement) => new DOMMatrixReadOnly(getComputedStyle(list).transform).m42

/**
 * How far the view scrolls to rest at the end of the content as it is laid out. What is still gliding or rising
 * into place is drawn below its place for a moment, and the view must not follow it there and then fall back.
 */
const restingEnd = (element: HTMLDivElement, list: HTMLOListElement) =>
  element.scrollTop + list.getBoundingClientRect().bottom - liftOf(list) - (element.getBoundingClientRect().top + element.clientTop + element.clientHeight)

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
 * It opens at the newest message. When a reply grows by a block, the view goes to the end at once, so the scroll
 * stays the user's, and the content is drawn where it was seen and glides up into place on the spring the rows
 * make room with. Under Still it does not glide.
 */
export function usePinnedScroll(): PinnedScroll {
  const scroller = useRef<HTMLDivElement | null>(null)
  const content = useRef<HTMLOListElement | null>(null)
  const following = useRef(true)
  const [pinned, setPinned] = useState(true)
  const still = useRef(false)
  still.current = useStill()
  const lift = useRef<AnimationPlaybackControls | null>(null)

  const toEnd = useCallback(() => {
    // A glide still under way ends in place first, so the end is where the content rests.
    lift.current?.stop()
    lift.current = null
    if (content.current) content.current.style.transform = ''
    const element = scroller.current
    if (element) element.scrollTop = element.scrollHeight
  }, [])

  // Every change in the content's height that no new message drew: a reply growing, an image that loaded.
  useLayoutEffect(() => {
    const list = content.current
    const element = scroller.current
    if (!list || !element) return
    toEnd()
    const observer = new ResizeObserver(() => {
      if (!following.current || restingEnd(element, list) - element.scrollTop < 0.5) return
      const before = element.scrollTop
      const drawn = liftOf(list)
      element.scrollTop = restingEnd(element, list)
      if (still.current) return
      lift.current?.stop()
      lift.current = animate(list, { transform: [`translateY(${drawn + element.scrollTop - before}px)`, 'translateY(0px)'] }, spring.sheet)
    })
    observer.observe(list)
    return () => {
      observer.disconnect()
      lift.current?.stop()
    }
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
