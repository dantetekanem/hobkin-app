/**
 * Away (spec 052, S9). The page is away while it is hidden, or once the window has been in the background for a
 * minute, and back at once when it shows again or takes focus. While away, `<html data-away>` pauses every CSS
 * animation (styles/globals.css), so a window nobody looks at does not move.
 */

/** How long the window stays in the background before the page is away. */
export const AWAY_AFTER_MS = 60_000

export interface PageState {
  hidden: boolean
  focused: boolean
  /** When the window went to the background, on `Date.now()`'s clock. Null while it has focus. */
  blurredAt: number | null
}

/** Whether the page is away at `now`: hidden, or a minute in the background. */
export function isAway({ hidden, focused, blurredAt }: PageState, now: number): boolean {
  if (hidden) return true
  return !focused && blurredAt !== null && now - blurredAt >= AWAY_AFTER_MS
}

export interface Page {
  document: EventTarget & {
    visibilityState: DocumentVisibilityState
    hasFocus(): boolean
    documentElement: { toggleAttribute(name: string, force: boolean): boolean }
  }
  window: EventTarget
}

/** Keeps `data-away` on the page's root as it is hidden, shown, sent to the background and brought back. Returns the stop. */
export function watchAway({ document, window }: Page): () => void {
  const startsFocused = document.hasFocus()
  let state: PageState = {
    hidden: document.visibilityState === 'hidden',
    focused: startsFocused,
    blurredAt: startsFocused ? null : Date.now(),
  }
  let timer: ReturnType<typeof setTimeout> | undefined

  const apply = () => {
    const now = Date.now()
    const away = isAway(state, now)
    document.documentElement.toggleAttribute('data-away', away)

    // In the background and not away yet: look again when its minute is up.
    clearTimeout(timer)
    timer = undefined
    if (!away && state.blurredAt !== null) timer = setTimeout(apply, state.blurredAt + AWAY_AFTER_MS - now)
  }

  // The window's own focus and blur, never an element's.
  const onBlur = (event: Event) => {
    if (event.target !== window) return
    state = { ...state, focused: false, blurredAt: state.blurredAt ?? Date.now() }
    apply()
  }
  const onFocus = (event: Event) => {
    if (event.target !== window) return
    state = { ...state, focused: true, blurredAt: null }
    apply()
  }

  // Showing again is coming back: a window still in the background starts its minute over.
  const onVisibility = () => {
    const hidden = document.visibilityState === 'hidden'
    const focused = document.hasFocus()
    let blurredAt: number | null = null
    if (!focused) blurredAt = hidden ? state.blurredAt : Date.now()

    state = { hidden, focused, blurredAt }
    apply()
  }

  window.addEventListener('blur', onBlur)
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibility)
  apply()
  return () => {
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisibility)
    clearTimeout(timer)
  }
}

// One watcher for the page. The stop lives on globalThis, so a hot update that runs this file again stops the copy
// before it instead of adding a second set of listeners.
const holder = globalThis as { __hobkinAway?: () => void }

/** Starts watching the page, after stopping a watcher an earlier copy of this file started. */
export function startAway(page: Page): void {
  holder.__hobkinAway?.()
  holder.__hobkinAway = watchAway(page)
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') startAway({ document, window })
