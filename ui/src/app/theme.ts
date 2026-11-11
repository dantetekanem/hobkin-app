import { useSyncExternalStore } from 'react'
import { DARK_PALETTE, LIGHT_PALETTE, isDarkPalette, onAccent, readablePalette, stepOpacity, type Palette } from '@/features/settings/rules.ts'
import { useSettings } from '@/features/settings/store.ts'

export type Theme = 'light' | 'dark'
/** What the user chose. `system` follows the Mac's appearance. `custom` is the user's own colors, from Settings. */
export type ThemeChoice = Theme | 'system' | 'custom'

/**
 * The same key hobkin.dev uses, so the choice reads the same everywhere. Absent means follow the Mac. With a custom
 * theme it holds the light or dark under the custom colors, so the first paint (index.html) is the nearer one.
 */
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

function remember(theme: Theme | null) {
  try {
    if (theme) localStorage.setItem(STORAGE_KEY, theme)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage can be unavailable. The theme still applies for this session.
  }
}

function current(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function choice(): ThemeChoice {
  return useSettings.getState().customTheme ? 'custom' : (saved() ?? 'system')
}

/** The custom colors to show: null when none are saved or they would not read. */
function customPalette(): Palette | null {
  return readablePalette(useSettings.getState().palette)
}

const baseOf = (palette: Palette): Theme => (isDarkPalette(palette) ? 'dark' : 'light')

function customVars(palette: Palette): Record<string, string> {
  return {
    '--hb-custom-bg': palette.background,
    '--hb-custom-surface': palette.surface,
    '--hb-custom-text': palette.text,
    '--hb-custom-muted': palette.muted,
    '--hb-custom-accent': palette.accent,
    '--hb-custom-on-accent': onAccent(palette.accent),
  }
}

function notify() {
  for (const listener of listeners) listener()
}

/** Shows a theme, and over it the custom colors when there are any (tokens.css mixes the rest of the palette). */
function apply(theme: Theme, palette: Palette | null = null) {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.classList.toggle('light', theme === 'light')
  for (const name of Object.keys(customVars(DARK_PALETTE))) root.style.removeProperty(name)
  if (palette) {
    for (const [name, value] of Object.entries(customVars(palette))) root.style.setProperty(name, value)
    root.dataset.palette = 'custom'
  } else {
    delete root.dataset.palette
  }
  notify()
}

/** How much of the backgrounds and cards shows. Text, icons and the focus ring never take it (globals.css). */
function showOpacity(opacity: number) {
  document.documentElement.style.setProperty('--hb-opacity', String(stepOpacity(opacity, 0)))
}

/**
 * Changes the theme as one smooth movement: the new theme opens in a circle from `origin`, the control
 * that was used, until it covers the window. With reduced motion, or where the browser cannot do it, the
 * colors cross-fade or switch at once.
 */
function reveal(theme: Theme, palette: Palette | null, origin?: { x: number; y: number }) {
  const root = document.documentElement
  const still = root.dataset.motion === 'still' || (root.dataset.motion !== 'lively' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  if (still) return apply(theme, palette)

  if (!document.startViewTransition) {
    // No view transitions here: let every color ease to its new value instead.
    root.dataset.themeFade = ''
    apply(theme, palette)
    setTimeout(() => delete root.dataset.themeFade, REVEAL_MS)
    return
  }

  const x = origin?.x ?? innerWidth / 2
  const y = origin?.y ?? 0
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  root.dataset.themeReveal = ''
  const transition = document.startViewTransition(() => apply(theme, palette))
  void transition.ready.then(() => {
    root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: REVEAL_MS, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', pseudoElement: '::view-transition-new(root)' },
    )
  })
  void transition.finished.finally(() => delete root.dataset.themeReveal)
}

/**
 * Sets what the user chose: light, dark, follow the Mac, or custom. Pass where the control is, so the new theme
 * opens from it. Custom starts from the colors showing now the first time, and from the saved ones after that.
 */
export function setThemeChoice(next: ThemeChoice, origin?: { x: number; y: number }) {
  const settings = useSettings.getState()
  if (next === 'custom' && !customPalette()) settings.setPalette(current() === 'dark' ? DARK_PALETTE : LIGHT_PALETTE)
  const palette = next === 'custom' ? customPalette() : null
  const theme: Theme = palette ? baseOf(palette) : next === 'light' || next === 'dark' ? next : system.matches ? 'dark' : 'light'
  remember(next === 'system' ? null : theme)
  settings.setCustomTheme(palette !== null)
  const showingCustom = document.documentElement.dataset.palette === 'custom'
  if (theme !== current() || (palette !== null) !== showingCustom) reveal(theme, palette, origin)
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
  if (choice() === 'system') reveal(event.matches ? 'dark' : 'light', null)
})

// Opacity and the custom colors apply as they change, without the reveal: they move in small steps.
useSettings.subscribe((state, before) => {
  if (state.backgroundOpacity !== before.backgroundOpacity) showOpacity(state.backgroundOpacity)
  const palette = state.customTheme && state.palette !== before.palette ? customPalette() : null
  if (palette) {
    remember(baseOf(palette))
    apply(baseOf(palette), palette)
  }
})

// What was saved, before the first render. index.html has already put on the light or dark under it.
showOpacity(useSettings.getState().backgroundOpacity)
const startPalette = useSettings.getState().customTheme ? customPalette() : null
if (startPalette) apply(baseOf(startPalette), startPalette)

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The theme showing now: the light or dark under a custom theme. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, current)
}

/** What the user chose, which may be to follow the Mac or custom colors. */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, choice)
}
