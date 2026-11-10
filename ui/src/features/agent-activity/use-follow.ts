import { animate, useMotionValue, type MotionValue } from 'motion/react'
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { spring } from '@/lib/motion.ts'

/** How close to the end still counts as being at the end, in pixels. */
const SLACK = 48

export interface Follow {
  /** The element that scrolls. */
  scroller: RefObject<HTMLDivElement | null>
  /** The list inside it, watched for growth. */
  content: RefObject<HTMLOListElement | null>
  /** The list's own offset while it glides back into place. Zero at rest. */
  y: MotionValue<number>
  /** True while the view follows the newest step. */
  pinned: boolean
  /** Goes to the newest step and follows it again. */
  jumpToLatest: () => void
  onScroll: () => void
  /** Call while drawing, before new steps are in place: notes where the list is on screen. */
  note: () => void
  /** Call once new steps are in place (a layout effect): follows them without a jump. */
  settle: () => void
}

/**
 * Keeps an agent's exchange at its newest step while it grows, unless the user scrolled up to read, the way the
 * conversation does, and never by a jump. New steps are followed with a smooth scroll. When the bottom shrinks, as
 * when a command folds into its group's row, the browser pulls everything above it down at once: the list is set
 * back where it was seen and glides down into place instead. Under Still both are immediate.
 */
export function useFollow(still: boolean): Follow {
  const scroller = useRef<HTMLDivElement | null>(null)
  const content = useRef<HTMLOListElement | null>(null)
  const following = useRef(true)
  const [pinned, setPinned] = useState(true)
  const y = useMotionValue(0)
  const seen = useRef<number | null>(null)
  const lastTop = useRef(0)

  const toEnd = useCallback(
    (smooth: boolean) => {
      const element = scroller.current
      if (!element) return
      const end = element.scrollHeight - element.clientHeight
      if (Math.abs(element.scrollTop - end) >= 1) element.scrollTo({ top: end, behavior: smooth && !still ? 'smooth' : 'auto' })
    },
    [still],
  )

  // It opens at the newest step: no scrolling to watch. Then it follows growth from inside a step, such as a diff
  // whose rows were measured or output that arrived, when no new step was drawn.
  useLayoutEffect(() => {
    const list = content.current
    if (!list) return
    toEnd(false)
    const observer = new ResizeObserver(() => {
      if (following.current) toEnd(true)
    })
    observer.observe(list)
    return () => observer.disconnect()
  }, [toEnd])

  const onScroll = useCallback(() => {
    const element = scroller.current
    if (!element) return
    const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight <= SLACK
    // Only moving up, away from the end, stops the following.
    if (atEnd) following.current = true
    else if (element.scrollTop < lastTop.current) following.current = false
    lastTop.current = element.scrollTop
    setPinned(following.current)
  }, [])

  const jumpToLatest = useCallback(() => {
    following.current = true
    setPinned(true)
    toEnd(true)
  }, [toEnd])

  const note = useCallback(() => {
    seen.current = following.current && content.current ? content.current.getBoundingClientRect().top : null
  }, [])

  const settle = useCallback(() => {
    const before = seen.current
    seen.current = null
    const list = content.current
    if (!list || !following.current) return
    // The list moved down: what was below the newest step got shorter. It starts where it was seen.
    const moved = before === null ? 0 : list.getBoundingClientRect().top - before
    if (moved > 0.5 && !still) {
      y.set(y.get() - moved)
      animate(y, 0, spring.sheet)
    }
    toEnd(true)
  }, [still, toEnd, y])

  return { scroller, content, y, pinned, jumpToLatest, onScroll, note, settle }
}
