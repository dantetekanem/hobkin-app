import { scrollsInside } from './boxes.ts'

/**
 * Keeps an agent's transcript at its newest step while it grows, unless the user scrolled up to read, the way the
 * conversation does. Only the user reading moves it off the end: a wheel or a drag upward, or a key that reads up. Layout,
 * focus and scroll anchoring also move the scroll, and they never do. A box the user opens or closes is read where it
 * is: the view holds still while it changes height, and follows again only if the end is still in view.
 *
 * Without React or a window, so its rules are tested with stand-ins. `use-follow.ts` gives it to the screens.
 */

/** How close to the end still counts as being at the end, in pixels. */
const SLACK = 48
/**
 * While the transcript opens, and after the user asks for the newest step, it goes to its end at once: no scrolling to
 * watch. A glide over a long transcript does not reach its end: the steps on the way are drawn only as they come into
 * view, each takes its real height then, and every such change starts the glide again from a standstill.
 */
const OPENING_MS = 600
/** A glide to the end is over well before this. One still short of the end by then stopped on the way, and lands at once. */
const GLIDE_MS = 800
/** Sent from a box the user opens or closes, so the transcript around it holds still. */
export const UNFOLD = 'hb-unfold'
/** How long a box takes to reach its new height. */
export const UNFOLD_MS = 300
/** Where a pointer or touch is let go, ending a drag. */
const RELEASES = ['pointerup', 'pointercancel', 'touchend', 'touchcancel']

interface Sizes {
  observe(target: Element): void
  disconnect(): void
}

export interface FollowOptions {
  /** Where a pointer or touch is let go: the window. */
  page: EventTarget
  /** Watches boxes change size: the page's ResizeObserver. */
  Observer: new (callback: () => void) => Sizes
  /** True while movement holds still. */
  still: () => boolean
  now: () => number
  /** Told whenever the view starts or stops following, so the way back down can be offered. */
  onPinned: (pinned: boolean) => void
}

export interface FollowControl {
  /** True while the view follows the newest step. */
  readonly following: boolean
  /** True when what moves may glide: not under Still, and not while the transcript opens. */
  readonly gliding: boolean
  /** Goes to the end, by a smooth scroll when asked for and gliding. */
  toEnd(smooth: boolean): void
  onScroll(): void
  /** Goes to the newest step and follows it again. */
  jumpToLatest(): void
  dispose(): void
}

/** Starts following the end of `element`, the box that scrolls, as `list`, the steps inside it, grows. */
export function followEnd(element: HTMLElement, list: HTMLElement, { page, Observer, still, now, onPinned }: FollowOptions): FollowControl {
  let landing = now() + OPENING_MS
  let following = true
  let lastTop = 0
  let dragging = false
  let held: ReturnType<typeof setTimeout> | undefined
  let arriving: ReturnType<typeof setTimeout> | undefined

  const gliding = () => !still() && now() > landing
  const atEnd = () => element.scrollHeight - element.scrollTop - element.clientHeight <= SLACK
  const pin = (value: boolean) => {
    following = value
    onPinned(value)
  }
  // Only when something moved it sideways: in the Mac's window any scroll the page asks for, this one included, stops
  // a glide that is under way, and the newest block would be left below the bottom.
  const unscrollSideways = () => {
    if (element.scrollLeft !== 0) element.scrollLeft = 0
  }
  const toEnd = (smooth: boolean) => {
    const end = element.scrollHeight - element.clientHeight
    unscrollSideways()
    if (Math.abs(element.scrollTop - end) >= 1) {
      const glide = smooth && gliding()
      element.scrollTo({ top: end, behavior: glide ? 'smooth' : 'auto' })
      if (glide) {
        // Whatever stops a glide on the way, the view still ends on the newest block while it follows.
        clearTimeout(arriving)
        arriving = setTimeout(() => following && toEnd(false), GLIDE_MS)
      }
    }
    lastTop = element.scrollTop
  }

  // A wheel that only scrolls a box inside the transcript leaves the view following.
  const wheel = (event: Event) => {
    const { deltaY, target } = event as WheelEvent
    if (deltaY < 0 && element.scrollTop > 0 && !scrollsInside(target as Element | null, deltaY)) pin(false)
  }
  const keyDown = (event: Event) => {
    const { key, shiftKey, target } = event as KeyboardEvent
    if ((target as Element | null)?.closest('input, textarea, [contenteditable="true"]')) return
    if (['ArrowUp', 'PageUp', 'Home'].includes(key) || (key === ' ' && shiftKey)) pin(false)
  }
  const press = () => {
    dragging = true
  }
  const release = () => {
    dragging = false
  }
  const unfold = (event: Event) => {
    following = false
    clearTimeout(held)
    held = setTimeout(() => pin(atEnd()), UNFOLD_MS + 50)

    // A box closing from above the view is brought back into it.
    const closing = (event as CustomEvent<{ closing: boolean }>).detail?.closing
    const above = (event.target as Element).getBoundingClientRect().top - element.getBoundingClientRect().top
    if (closing && above < 0) element.scrollBy({ top: above, behavior: still() ? 'auto' : 'smooth' })
  }

  // Growth from inside a step, such as a diff whose rows were measured or output that arrived, when no new step was
  // drawn. And the transcript's own box changing height, as when the input under it grows or the window is resized.
  const sizes = new Observer(() => {
    if (following) toEnd(true)
  })
  sizes.observe(list)
  sizes.observe(element)
  element.addEventListener('wheel', wheel, { passive: true })
  element.addEventListener('keydown', keyDown)
  element.addEventListener('pointerdown', press)
  element.addEventListener('touchstart', press, { passive: true })
  // Heard on the way down, before anything on the page can keep the release to itself.
  for (const name of RELEASES) page.addEventListener(name, release, true)
  list.addEventListener(UNFOLD, unfold)
  toEnd(false)

  return {
    get following() {
      return following
    },
    get gliding() {
      return gliding()
    },
    toEnd,
    onScroll() {
      // Layout, focus and scroll anchoring also move the scroll: only an actual drag gives up following here.
      const reachedEnd = atEnd()
      unscrollSideways()
      if (reachedEnd && element.scrollTop > lastTop) following = true
      else if (dragging && element.scrollTop < lastTop) following = false
      lastTop = element.scrollTop
      onPinned(following)
    },
    jumpToLatest() {
      // The click that asked for this is over, whether or not its release was heard: no drag is under way.
      dragging = false
      landing = now() + OPENING_MS
      pin(true)
      toEnd(false)
    },
    dispose() {
      sizes.disconnect()
      element.removeEventListener('wheel', wheel)
      element.removeEventListener('keydown', keyDown)
      element.removeEventListener('pointerdown', press)
      element.removeEventListener('touchstart', press)
      for (const name of RELEASES) page.removeEventListener(name, release, true)
      list.removeEventListener(UNFOLD, unfold)
      clearTimeout(held)
      clearTimeout(arriving)
    },
  }
}
