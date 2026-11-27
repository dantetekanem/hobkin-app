import { scrollsInside } from './boxes.ts'

/**
 * Keeps an agent's transcript at its newest step while it grows, unless the user scrolled up to read, the way the
 * conversation does. Only the user reading moves it off the end: a wheel or a drag upward, or a key that reads up. Layout,
 * focus and scroll anchoring also move the scroll, and they never do. A box the user opens or closes is read where it
 * is: the view holds still while it changes height, and follows again only if the end is still in view.
 *
 * It goes to the end at once, never by a smooth scroll, and only once the page has laid out what changed: the page tells
 * what changed size once a frame (its ResizeObserver), so however many steps arrive in a frame, the view is written at
 * most once, and nothing is read of the page while it draws. A page that is hidden, or covered so it is not drawn, lays
 * nothing out and writes nothing.
 *
 * Without React or a window, so its rules are tested with stand-ins. `use-follow.ts` gives it to the screens.
 */

/** How close to the end still counts as being at the end, in pixels. */
const SLACK = 48
/** Sent from a box the user opens or closes, so the transcript around it holds still. */
export const UNFOLD = 'hb-unfold'
/** How long the view holds still once a box opened or closed, before it follows again if the end is still in view. */
const HOLD_MS = 350
/** Where a pointer or touch is let go, ending a drag. */
const RELEASES = ['pointerup', 'pointercancel', 'touchend', 'touchcancel']

interface Sizes {
  observe(target: Element): void
  disconnect(): void
}

/**
 * Where a transcript starts: following its newest step, as one with no start does, or held `top` pixels down where the
 * user left it reading, not following until they scroll back down to the end.
 */
export interface FollowStart {
  following: boolean
  top: number
}

export interface FollowOptions {
  /** Where a pointer or touch is let go: the window. */
  page: EventTarget
  /** Watches boxes change size: the page's ResizeObserver. */
  Observer: new (callback: () => void) => Sizes
  /** Told whenever the view starts or stops following, so the way back down can be offered. */
  onPinned: (pinned: boolean) => void
  /** Where it starts. Without one, at the newest step, following it. */
  start?: FollowStart
  /**
   * A windowed transcript (windowed-list.tsx) is laid out again as its rows are drawn in and out, and WebKit can leave
   * its view off the end as it does, with nothing changing size to tell of it (the Safari rig, 2026-11-26). With this,
   * while it follows, a scroll off the end that is not the user's own goes back to the end at once. A step the keyboard
   * moved onto is still brought into view, as in a transcript drawn whole.
   */
  holdsEnd?: boolean
}

export interface FollowControl {
  /** True while the view follows the newest step. */
  readonly following: boolean
  /** Goes to the end, at once. */
  toEnd(): void
  onScroll(): void
  /** Goes to the newest step and follows it again. */
  jumpToLatest(): void
  dispose(): void
}

/** Starts following the end of `element`, the box that scrolls, as `list`, the steps inside it, grows. */
export function followEnd(element: HTMLElement, list: HTMLElement, { page, Observer, onPinned, start, holdsEnd = false }: FollowOptions): FollowControl {
  let following = start?.following ?? true
  let lastTop = 0
  let dragging = false
  let held: ReturnType<typeof setTimeout> | undefined

  const atEnd = () => element.scrollHeight - element.scrollTop - element.clientHeight <= SLACK
  // Whether the keyboard is on a step of the list: moving onto one brings it into view, and that is no drift.
  const onStep = () => {
    const active = list.ownerDocument?.activeElement
    return Boolean(active && list.contains(active) && active.closest('[data-step]'))
  }
  const pin = (value: boolean) => {
    following = value
    onPinned(value)
  }
  // A transcript never scrolls sideways. Whatever moved it so is undone, and only then: each write is a scroll.
  const unscrollSideways = () => {
    if (element.scrollLeft !== 0) element.scrollLeft = 0
  }
  const toEnd = () => {
    const end = element.scrollHeight - element.clientHeight
    unscrollSideways()
    if (Math.abs(element.scrollTop - end) >= 1) element.scrollTo({ top: end, behavior: 'auto' })
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
    held = setTimeout(() => pin(atEnd()), HOLD_MS)

    // A box closing from above the view is brought back into it.
    const closing = (event as CustomEvent<{ closing: boolean }>).detail?.closing
    const above = (event.target as Element).getBoundingClientRect().top - element.getBoundingClientRect().top
    if (closing && above < 0) element.scrollBy({ top: above, behavior: 'auto' })
  }

  // New steps, growth from inside a step such as output that arrived, and the transcript's own box changing height, as
  // when the input under it grows or the window is resized: the page tells of them once a frame, laid out.
  const sizes = new Observer(() => {
    if (following) toEnd()
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
  // It opens at the newest step: no scrolling to watch. One left where the user read opens there. Given a start, it
  // says which, as a page shown again may have been following or not when it was hidden.
  if (following) toEnd()
  else if (start) {
    unscrollSideways()
    element.scrollTo({ top: start.top, behavior: 'auto' })
    lastTop = element.scrollTop
  }
  if (start) onPinned(following)

  return {
    get following() {
      return following
    },
    toEnd,
    onScroll() {
      // Layout, focus and scroll anchoring also move the scroll: only an actual drag gives up following here.
      const reachedEnd = atEnd()
      unscrollSideways()
      if (reachedEnd && element.scrollTop > lastTop) following = true
      else if (dragging && element.scrollTop < lastTop) following = false
      else if (holdsEnd && following && !dragging && !reachedEnd && !onStep()) toEnd()
      lastTop = element.scrollTop
      onPinned(following)
    },
    jumpToLatest() {
      // The click that asked for this is over, whether or not its release was heard: no drag is under way.
      dragging = false
      pin(true)
      toEnd()
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
    },
  }
}
