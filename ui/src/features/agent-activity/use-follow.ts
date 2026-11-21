import { animate, useMotionValue, type AnimationPlaybackControls, type MotionValue } from 'motion/react'
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { spring } from '@/lib/motion.ts'
import { followEnd, type FollowControl } from './follow.ts'

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
 * Keeps an agent's exchange at its newest step while it grows, unless the user scrolled up to read (follow.ts), and
 * never by a jump. New steps are followed with a smooth scroll. When the bottom shrinks, as when a command folds into
 * its group's row, the browser pulls everything above it down at once: the list is set back where it was seen and
 * glides down into place instead. Under Still both are immediate.
 */
export function useFollow(still: boolean): Follow {
  const scroller = useRef<HTMLDivElement | null>(null)
  const content = useRef<HTMLOListElement | null>(null)
  const control = useRef<FollowControl | null>(null)
  const [pinned, setPinned] = useState(true)
  const y = useMotionValue(0)
  const glide = useRef<AnimationPlaybackControls | null>(null)
  const seen = useRef<number | null>(null)
  const holding = useRef(still)
  holding.current = still

  // It opens at the newest step: no scrolling to watch.
  useLayoutEffect(() => {
    const element = scroller.current
    const list = content.current
    if (!element || !list) return
    const follow = followEnd(element, list, { page: window, Observer: ResizeObserver, still: () => holding.current, now: () => performance.now(), onPinned: setPinned })
    control.current = follow
    return () => {
      follow.dispose()
      if (control.current === follow) control.current = null
    }
  }, [])

  const onScroll = useCallback(() => control.current?.onScroll(), [])
  // Clear any in-flight shrink-glide and its leftover offset first, so the jump lands on the real newest step
  // instead of a step the transform is still holding below the fold.
  const jumpToLatest = useCallback(() => {
    glide.current?.stop()
    y.set(0)
    control.current?.jumpToLatest()
  }, [y])

  const note = useCallback(() => {
    seen.current = control.current?.following && content.current ? content.current.getBoundingClientRect().top : null
  }, [])

  const settle = useCallback(() => {
    const before = seen.current
    seen.current = null
    const follow = control.current
    const list = content.current
    if (!follow || !list || !follow.following) return
    // The list moved down: what was below the newest step got shorter. It starts where it was seen.
    const moved = before === null ? 0 : list.getBoundingClientRect().top - before
    glide.current?.stop()
    if (moved > 0.5 && follow.gliding) {
      y.set(y.get() - moved)
      glide.current = animate(y, 0, spring.sheet)
    } else {
      // No glide this time: never leave the transcript held off its end by a stale offset.
      y.set(0)
    }
    follow.toEnd(true)
  }, [y])

  return { scroller, content, y, pinned, jumpToLatest, onScroll, note, settle }
}
