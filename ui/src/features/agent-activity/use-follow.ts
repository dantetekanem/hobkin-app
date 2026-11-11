import { animate, useMotionValue, type MotionValue } from 'motion/react'
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { spring } from '@/lib/motion.ts'
import { scrollsInside } from './boxes.ts'
import { UNFOLD, UNFOLD_MS } from './unfold.ts'

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
  const dragging = useRef(false)
  const opening = useRef(0)

  const toEnd = useCallback(
    (smooth: boolean) => {
      const element = scroller.current
      if (!element) return
      const end = element.scrollHeight - element.clientHeight
      element.scrollLeft = 0
      if (Math.abs(element.scrollTop - end) >= 1) element.scrollTo({ top: end, behavior: smooth && !still && performance.now() > opening.current ? 'smooth' : 'auto' })
      lastTop.current = element.scrollTop
    },
    [still],
  )

  // It opens at the newest step: no scrolling to watch. Then it follows growth from inside a step, such as a diff
  // whose rows were measured or output that arrived, when no new step was drawn.
  useLayoutEffect(() => {
    const list = content.current
    if (!list) return
    opening.current = performance.now() + 600
    toEnd(false)
    const element = scroller.current
    if (!element) return
    const reading = () => { following.current = false; setPinned(false) }
    // A wheel that only scrolls a box inside the transcript leaves the view following.
    const wheel = (event: WheelEvent) => { if (event.deltaY < 0 && element.scrollTop > 0 && !scrollsInside(event.target as Element | null, event.deltaY)) reading() }
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) reading()
    }
    const down = () => { dragging.current = true }
    const up = () => { dragging.current = false }
    element.addEventListener('wheel', wheel, { passive: true })
    element.addEventListener('keydown', key)
    element.addEventListener('pointerdown', down)
    element.addEventListener('touchstart', down, { passive: true })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('touchend', up)
    window.addEventListener('touchcancel', up)
    const observer = new ResizeObserver(() => {
      if (following.current) toEnd(true)
    })
    // A box the user opens or closes is read where it is: the view holds still while it changes height, and follows
    // again only if the end is still in view. A box closing from above the view is brought back into it.
    let held: ReturnType<typeof setTimeout> | undefined
    const unfold = (event: Event) => {
      const element = scroller.current
      if (!element) return
      following.current = false
      clearTimeout(held)
      held = setTimeout(() => {
        following.current = element.scrollHeight - element.scrollTop - element.clientHeight <= SLACK
        setPinned(following.current)
      }, UNFOLD_MS + 50)
      const above = (event.target as HTMLElement).getBoundingClientRect().top - element.getBoundingClientRect().top
      if ((event as CustomEvent<{ closing: boolean }>).detail?.closing && above < 0) element.scrollBy({ top: above, behavior: still ? 'auto' : 'smooth' })
    }
    observer.observe(list)
    list.addEventListener(UNFOLD, unfold)
    return () => {
      observer.disconnect()
      element.removeEventListener('wheel', wheel)
      element.removeEventListener('keydown', key)
      element.removeEventListener('pointerdown', down)
      element.removeEventListener('touchstart', down)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('touchend', up)
      window.removeEventListener('touchcancel', up)
      list.removeEventListener(UNFOLD, unfold)
      clearTimeout(held)
    }
  }, [toEnd, still])

  const onScroll = useCallback(() => {
    const element = scroller.current
    if (!element) return
    const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight <= SLACK
    // Layout/focus/scroll anchoring also move scrollTop: only an actual drag can give up ownership here.
    element.scrollLeft = 0
    if (atEnd && element.scrollTop > lastTop.current) following.current = true
    else if (dragging.current && element.scrollTop < lastTop.current) following.current = false
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
    if (moved > 0.5 && !still && performance.now() > opening.current) {
      y.set(y.get() - moved)
      animate(y, 0, spring.sheet)
    }
    toEnd(true)
  }, [still, toEnd, y])

  return { scroller, content, y, pinned, jumpToLatest, onScroll, note, settle }
}
