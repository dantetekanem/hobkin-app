import { animate, type AnimationPlaybackControls } from 'motion/react'
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useStill } from '@/app/still.ts'
import { UNFOLD } from '@/features/agent-activity/follow.ts'
import { spring } from '@/lib/motion.ts'
import { followAfter, START, type FollowEvent } from './follow.ts'

/** Where a pointer or finger is let go, ending a drag. A touch that pans cancels its pointer while the finger is still down. */
const RELEASES = ['pointerup', 'touchend', 'touchcancel']
/** How long the view holds still once a row opened or closed in place, as an agent's transcript holds. */
const HOLD_MS = 350

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
 * Keeps a conversation at its newest message while it grows, unless the user scrolled up to read (`follow.ts`).
 * It opens at the newest message. When a reply grows by a block, the view goes to the end at once, so the scroll
 * stays the user's, and the content is drawn where it was seen and glides up into place on the spring the rows
 * make room with. Under Still it does not glide.
 */
export function usePinnedScroll(): PinnedScroll {
  const scroller = useRef<HTMLDivElement | null>(null)
  const content = useRef<HTMLOListElement | null>(null)
  const follow = useRef(START)
  const [pinned, setPinned] = useState(true)
  const still = useRef(false)
  still.current = useStill()
  const lift = useRef<AnimationPlaybackControls | null>(null)

  const tell = useCallback((event: FollowEvent) => {
    follow.current = followAfter(follow.current, event)
    setPinned(follow.current.following)
  }, [])

  const toEnd = useCallback(() => {
    // A glide still under way ends in place first, so the end is where the content rests.
    lift.current?.stop()
    lift.current = null
    if (content.current) content.current.style.transform = ''
    const element = scroller.current
    if (element) element.scrollTop = element.scrollHeight
  }, [])

  useLayoutEffect(() => {
    const list = content.current
    const element = scroller.current
    if (!list || !element) return
    toEnd()
    // Every change in the content's height that no new message drew: a reply growing, an image that loaded, content that
    // shrank. And the conversation's own box changing height, as when the input under it grows or the window is resized.
    const observer = new ResizeObserver((entries) => {
      if (!follow.current.following) return
      const before = element.scrollTop
      const end = Math.max(0, restingEnd(element, list))
      if (Math.abs(end - before) < 0.5) return
      const drawn = liftOf(list)
      element.scrollTop = end

      // Only content that grew glides up into place. The box itself changing height, or content that shrank, does not.
      const listGrew = end > before && entries.some(({ target }) => target === list)
      if (!listGrew || still.current) return
      lift.current?.stop()
      lift.current = animate(list, { transform: [`translateY(${drawn + element.scrollTop - before}px)`, 'translateY(0px)'] }, spring.sheet)
    })
    observer.observe(list)
    observer.observe(element)

    // A row the user opens or closes in place, such as a digest (`tellUnfold`), is read where it is: the view holds while
    // it changes height, and follows again only if the end is still in view. The way down is offered only then, so it
    // does not flash while a row closes at the end.
    let settling: ReturnType<typeof setTimeout> | undefined
    const settle = () => {
      tell({ type: 'settle', top: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight })
    }
    const unfold = () => {
      follow.current = followAfter(follow.current, { type: 'unfold' })
      clearTimeout(settling)
      settling = setTimeout(settle, HOLD_MS)
    }
    list.addEventListener(UNFOLD, unfold)

    // What the user does to read up. The scroll alone cannot tell it from layout.
    const wheel = (event: WheelEvent) => tell({ type: 'wheel', deltaY: event.deltaY, top: element.scrollTop })
    const key = (event: KeyboardEvent) => tell({ type: 'key', key: event.key, shiftKey: event.shiftKey })
    const press = () => tell({ type: 'press' })
    const release = () => tell({ type: 'release' })
    element.addEventListener('wheel', wheel, { passive: true })
    element.addEventListener('keydown', key)
    element.addEventListener('pointerdown', press)
    element.addEventListener('touchstart', press, { passive: true })
    // Heard on the way down, before anything on the page can keep the release to itself.
    for (const name of RELEASES) window.addEventListener(name, release, true)
    return () => {
      observer.disconnect()
      list.removeEventListener(UNFOLD, unfold)
      clearTimeout(settling)
      lift.current?.stop()
      element.removeEventListener('wheel', wheel)
      element.removeEventListener('keydown', key)
      element.removeEventListener('pointerdown', press)
      element.removeEventListener('touchstart', press)
      for (const name of RELEASES) window.removeEventListener(name, release, true)
    }
  }, [toEnd, tell])

  const onScroll = useCallback(() => {
    const element = scroller.current
    if (element) tell({ type: 'scroll', top: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight })
  }, [tell])

  const jumpToLatest = useCallback(() => {
    tell({ type: 'jump' })
    toEnd()
  }, [tell, toEnd])

  const scrollByPage = useCallback((direction: 1 | -1) => {
    const element = scroller.current
    // Page Up in the input reads up, as it would in the conversation itself.
    if (direction < 0) tell({ type: 'key', key: 'PageUp' })
    element?.scrollBy({ top: direction * element.clientHeight * 0.8 })
  }, [tell])

  const stick = useCallback(() => {
    if (follow.current.following) toEnd()
  }, [toEnd])

  return { scroller, content, pinned, jumpToLatest, stick, scrollByPage, onScroll }
}
