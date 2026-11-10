import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'
/** What the user chose. `system` follows the Mac's appearance. */
export type ThemeChoice = Theme | 'system'

/** The same key hobkin.dev uses, so the choice reads the same everywhere. Absent means follow the Mac. */
const STORAGE_KEY = 'hobkin-theme'
const REVEAL_MS = 620
const listeners = new Set<() => void>()
const system = matchMedia('(prefers-color-scheme: dark)')

function saved(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

function current(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function choice(): ThemeChoice {
  return saved() ?? 'system'
}

function notify() {
  for (const listener of listeners) listener()
}

function apply(theme: Theme) {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.classList.toggle('light', theme === 'light')
  notify()
}

/**
 * Changes the theme as one smooth movement: the new theme opens in a circle from `origin`, the control
 * that was used, until it covers the window. With reduced motion, or where the browser cannot do it, the
 * colors cross-fade or switch at once.
 */
function reveal(theme: Theme, origin?: { x: number; y: number }) {
  const root = document.documentElement
  const still = root.dataset.motion === 'still' || (root.dataset.motion !== 'lively' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  if (still) return apply(theme)

  if (!document.startViewTransition) {
    // No view transitions here: let every color ease to its new value instead.
    root.dataset.themeFade = ''
    apply(theme)
    setTimeout(() => delete root.dataset.themeFade, REVEAL_MS)
    return
  }

  const x = origin?.x ?? innerWidth / 2
  const y = origin?.y ?? 0
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  root.dataset.themeReveal = ''
  const transition = document.startViewTransition(() => apply(theme))
  void transition.ready.then(() => {
    root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: REVEAL_MS, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', pseudoElement: '::view-transition-new(root)' },
    )
  })
  void transition.finished.finally(() => delete root.dataset.themeReveal)
}

/** Sets what the user chose: light, dark, or follow the Mac. Pass where the control is, so the new theme opens from it. */
export function setThemeChoice(next: ThemeChoice, origin?: { x: number; y: number }) {
  try {
    if (next === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Storage can be unavailable. The theme still applies for this session.
  }
  const theme = next === 'system' ? (system.matches ? 'dark' : 'light') : next
  if (theme !== current()) reveal(theme, origin)
  else notify()
}

/** Switches between light and dark. */
export function toggleTheme(origin?: { x: number; y: number }) {
  setThemeChoice(current() === 'dark' ? 'light' : 'dark', origin)
}

/** The middle of the element an event came from, for the reveal. Works for keyboard presses too. */
export function originOf(element: Element): { x: number; y: number } {
  const box = element.getBoundingClientRect()
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}

// While the choice is to follow the Mac, follow it.
system.addEventListener('change', (event) => {
  if (!saved()) reveal(event.matches ? 'dark' : 'light')
})

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The theme showing now. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, current)
}

/** What the user chose, which may be to follow the Mac. */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, choice)
}
