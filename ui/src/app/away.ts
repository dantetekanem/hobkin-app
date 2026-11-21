/**
 * Away (spec 052, S9). The page is away while it is hidden, or once the window has been in the background for a
 * minute with no pointer, wheel or key over it. It is back at once when it shows again, takes focus, or the user moves
 * over it. While away, the page's endless loops hold still (holdLoops); everything that runs once (an entrance, a
 * fade, a tooltip opening) runs as usual, so a window someone can still see never looks broken. `<html data-away>`
 * marks the state; no style depends on it.
 */

/** How long the window stays in the background, with nothing moving over it, before the page is away. */
export const AWAY_AFTER_MS = 60_000

export interface PageState {
  hidden: boolean
  focused: boolean
  /** When the user last showed up while the window was in the background: it left focus, or a pointer, wheel or key. */
  quietSince: number
}

/** Whether the page is away at `now`: hidden, or out of focus with a quiet minute behind it. */
export function isAway({ hidden, focused, quietSince }: PageState, now: number): boolean {
  if (hidden) return true
  if (focused) return false
  return now - quietSince >= AWAY_AFTER_MS
}

/** What holdLoops reads and changes of an animation: `Animation` in the page, a stand-in in a test. */
export interface Loopable {
  playbackRate: number
  /** 'idle' once its element has gone or its CSS no longer names it. */
  playState: string
  effect: { getTiming(): { iterations?: number } } | null
}

/** An animation that never ends: a CSS animation with an infinite iteration count, or a script one. */
function isLoop(animation: Loopable): boolean {
  return animation.effect?.getTiming().iterations === Infinity
}

// Every loop someone holds, with how many hold it and the speed it had. On globalThis, so a hot update that runs this
// file again shares it with the copy before it, and the page and the covered chat can hold the same loop.
const holder = globalThis as { __hobkinHeldLoops?: Map<Loopable, { holds: number; rate: number }>; __hobkinAway?: () => void }
const heldLoops = (holder.__hobkinHeldLoops ??= new Map())

function hold(animation: Loopable): void {
  const held = heldLoops.get(animation)
  if (held) {
    held.holds += 1
    return
  }
  heldLoops.set(animation, { holds: 1, rate: animation.playbackRate })
  animation.playbackRate = 0
}

function letGo(animation: Loopable): void {
  const held = heldLoops.get(animation)
  if (!held) return
  held.holds -= 1
  if (held.holds > 0) return
  heldLoops.delete(animation)
  animation.playbackRate = held.rate
}

/**
 * Holds every endless loop in `scope` still, the ones running now and the ones that start until the returned function
 * lets them go, which plays exactly those again at the speed they had. A loop stands still at a playback rate of 0:
 * pausing it through script would take it out of CSS's hands for good (a `:hover` pause would stop working), and a
 * rate leaves its play state to CSS. Animations that run once are never touched.
 */
export function holdLoops(scope: EventTarget, animationsNow: () => Iterable<Loopable>): () => void {
  const mine = new Set<Loopable>()
  let pruneAt = 64

  const take = (animations: Iterable<Loopable>) => {
    for (const animation of animations) {
      if (mine.has(animation) || !isLoop(animation)) continue
      mine.add(animation)
      hold(animation)
    }
    // A long time away keeps meeting new loops; the ones whose element went are let go now and then.
    if (mine.size < pruneAt) return
    for (const animation of mine) {
      if (animation.playState !== 'idle') continue
      mine.delete(animation)
      letGo(animation)
    }
    pruneAt = Math.max(64, mine.size * 2)
  }
  // The element an animation starts on, with its pseudo-elements and what is inside it.
  const onStart = (event: Event) => {
    const target = event.target as { getAnimations?: (options?: { subtree: boolean }) => Iterable<Loopable> } | null
    take(target?.getAnimations?.({ subtree: true }) ?? [])
  }

  take(animationsNow())
  scope.addEventListener('animationstart', onStart)
  return () => {
    scope.removeEventListener('animationstart', onStart)
    for (const animation of mine) letGo(animation)
    mine.clear()
  }
}

export interface Page {
  document: EventTarget & {
    visibilityState: DocumentVisibilityState
    hasFocus(): boolean
    getAnimations(): Iterable<Loopable>
    documentElement: { toggleAttribute(name: string, force: boolean): boolean }
  }
  window: EventTarget
}

/** What over a window in the background says the user is there. */
const PRESENCE = ['pointermove', 'pointerdown', 'wheel', 'keydown'] as const
const QUIET_LISTENER = { capture: true, passive: true } as const

/**
 * Keeps `data-away` on the page's root and its loops held while it is away, as it is hidden, shown, sent to the
 * background, brought back or moved over. Returns the stop, which lets every held loop go.
 */
export function watchAway({ document, window }: Page): () => void {
  const state: PageState = {
    hidden: document.visibilityState === 'hidden',
    focused: document.hasFocus(),
    quietSince: Date.now(),
  }
  let away = false
  let release: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  const apply = () => {
    const now = Date.now()
    away = isAway(state, now)
    document.documentElement.toggleAttribute('data-away', away)
    if (away && !release) release = holdLoops(document, () => document.getAnimations())
    if (!away && release) {
      release()
      release = null
    }

    // In the background and not away yet: look again when its quiet minute would be up.
    clearTimeout(timer)
    timer = undefined
    if (!away && !state.focused) timer = setTimeout(apply, state.quietSince + AWAY_AFTER_MS - now)
  }

  // Called for every pointer move over the window, so it only notes the time unless the page is away.
  const onPresence = () => {
    if (state.focused) return
    state.quietSince = Date.now()
    if (away) apply()
  }
  // The window's own focus and blur, never an element's.
  const onBlur = (event: Event) => {
    if (event.target !== window) return
    state.focused = false
    state.quietSince = Date.now()
    apply()
  }
  const onFocus = (event: Event) => {
    if (event.target !== window) return
    state.focused = true
    apply()
  }
  // Showing again is coming back: a window still in the background starts its quiet minute over.
  const onVisibility = () => {
    state.hidden = document.visibilityState === 'hidden'
    state.focused = document.hasFocus()
    if (!state.hidden) state.quietSince = Date.now()
    apply()
  }

  for (const type of PRESENCE) window.addEventListener(type, onPresence, QUIET_LISTENER)
  window.addEventListener('blur', onBlur)
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibility)
  apply()
  return () => {
    for (const type of PRESENCE) window.removeEventListener(type, onPresence, QUIET_LISTENER)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisibility)
    clearTimeout(timer)
    release?.()
    document.documentElement.toggleAttribute('data-away', false)
  }
}

/** Starts watching the page, after stopping a watcher an earlier copy of this file started (a hot update). */
export function startAway(page: Page): void {
  holder.__hobkinAway?.()
  holder.__hobkinAway = watchAway(page)
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') startAway({ document, window })
