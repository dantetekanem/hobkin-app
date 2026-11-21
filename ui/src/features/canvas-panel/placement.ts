/**
 * When the page canvas looks again at where its page area is and whether anything covers it (spec 052, S10). A native
 * view draws over everything in the window, so it must follow its area and hide under anything that covers it. It used
 * to look on every frame for as long as a page was open. It now looks when something can have moved or covered the
 * area, follows every frame only while something moves, and otherwise rests. The rule is pure, so it is tested without
 * a window; `followArea` wires it to the page's events.
 */

/** How often the canvas looks anyway, for a cover that no event announced. */
export const FALLBACK_MS = 250

export type Moment =
  /** Something that can move or cover the area happened: a resize, a transition or animation, something added to the page. */
  | { cue: 'change'; asked: boolean; visible: boolean }
  /** The slow look's time came. */
  | { cue: 'tick'; asked: boolean; visible: boolean }
  /** A look just ran: whether it found the area's place or cover changed, and whether anything that ends is moving. */
  | { cue: 'looked'; changed: boolean; moving: boolean }

/**
 * What the canvas does now: look on the next frame, look at once, or rest. A change looks on the next frame, once
 * however many changes a frame brings (`asked`). After a look it looks again on the next frame while the look found a
 * change or something is still moving, and rests once neither is true. The slow look runs only while the page is
 * visible and no frame is coming.
 */
export function decide(moment: Moment): 'next frame' | 'now' | 'rest' {
  if (moment.cue === 'looked') return moment.changed || moment.moving ? 'next frame' : 'rest'
  if (moment.asked) return 'rest'
  if (moment.cue === 'change') return 'next frame'
  return moment.visible ? 'now' : 'rest'
}

interface AnimationLike {
  playState: string
  effect: { getComputedTiming(): { endTime?: number | unknown } } | null
}

/** Whether a transition or animation that will end is running. An endless loop, or a paused one, moves nothing that matters here. */
export function movingNow(animations: Iterable<AnimationLike>): boolean {
  for (const { playState, effect } of animations) {
    if (playState === 'running' && effect && Number.isFinite(Number(effect.getComputedTiming().endTime))) return true
  }
  return false
}

type Listening = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>

/** What the canvas reads of the page, handed in so a test can stand in for it. */
export interface FollowPage {
  window: Listening & Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame' | 'setInterval' | 'clearInterval'>
  document: Listening & Pick<Document, 'body' | 'visibilityState' | 'getAnimations'>
  ResizeObserver: typeof ResizeObserver
  MutationObserver: typeof MutationObserver
}

const thePage = (): FollowPage => ({ window, document, ResizeObserver, MutationObserver })

/** Runs `read` every `ms` while the page is visible, and once at once whenever it shows again. Returns the stop. */
export function everyWhileVisible(ms: number, read: () => void, page: Pick<FollowPage, 'window' | 'document'> = thePage()): () => void {
  let timer: number | null = null
  const follow = () => {
    if (timer !== null) page.window.clearInterval(timer)
    timer = null
    if (page.document.visibilityState !== 'visible') return
    timer = page.window.setInterval(read, ms)
  }
  const onVisibility = () => {
    follow()
    if (page.document.visibilityState === 'visible') read()
  }
  follow()
  page.document.addEventListener('visibilitychange', onVisibility)
  return () => {
    if (timer !== null) page.window.clearInterval(timer)
    timer = null
    page.document.removeEventListener('visibilitychange', onVisibility)
  }
}

/** Transitions and animations starting or ending anywhere on the page: what can slide a sheet over the area or move it. */
const MOTION_EVENTS = ['transitionrun', 'transitionend', 'transitioncancel', 'animationstart', 'animationend', 'animationcancel'] as const

/**
 * Looks at the area when something can have changed it, by `decide`. `look` places the native view and says whether
 * its place or cover changed. The canvas also calls `cue` for its own changes: leaving, or another page from hobkin.
 */
export function followArea(area: Element, look: () => boolean, page: FollowPage = thePage()): { cue(): void; stop(): void } {
  let frame: number | null = null
  const asked = () => frame !== null
  const visible = () => page.document.visibilityState === 'visible'

  const lookNow = () => {
    const changed = look()
    // Asked only when the look found nothing new: reading every animation of the page is not free.
    const moving = !changed && movingNow(page.document.getAnimations())
    if (decide({ cue: 'looked', changed, moving }) === 'next frame') ask()
  }
  const ask = () => {
    if (asked()) return
    frame = page.window.requestAnimationFrame(() => {
      frame = null
      lookNow()
    })
  }
  const cue = () => {
    if (decide({ cue: 'change', asked: asked(), visible: visible() }) === 'next frame') ask()
  }
  const tick = () => {
    if (decide({ cue: 'tick', asked: asked(), visible: visible() }) === 'now') lookNow()
  }

  const sizes = new page.ResizeObserver(cue)
  sizes.observe(area)
  // A dialog, a sheet or a menu that opens over the area is added to the page.
  const added = new page.MutationObserver(cue)
  added.observe(page.document.body, { childList: true, subtree: true })
  page.window.addEventListener('resize', cue)
  page.document.addEventListener('visibilitychange', cue)
  for (const type of MOTION_EVENTS) page.document.addEventListener(type, cue, true)
  const stopTicks = everyWhileVisible(FALLBACK_MS, tick, page)
  cue()

  return {
    cue,
    stop() {
      if (frame !== null) page.window.cancelAnimationFrame(frame)
      frame = null
      sizes.disconnect()
      added.disconnect()
      page.window.removeEventListener('resize', cue)
      page.document.removeEventListener('visibilitychange', cue)
      for (const type of MOTION_EVENTS) page.document.removeEventListener(type, cue, true)
      stopTicks()
    },
  }
}
