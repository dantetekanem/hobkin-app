import { useSyncExternalStore } from 'react'
import { borderColors } from '#shared/protocol/appearance.ts'
import { BASE_THEME_SETTINGS, DARK_PALETTE, LIGHT_PALETTE, adjustedPalette, backgroundImageCss, isDarkPalette, onAccent, stepOpacity, type Background, type Palette } from '@/features/settings/rules.ts'
import { themeToRestore } from '@/features/settings/kept-themes.ts'
import { useSettings, watchAppearance } from '@/features/settings/store.ts'
import { hostStore, runCommand } from '@/lib/host/client.ts'
import { tellHostTheme } from './theme-host.ts'

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

/** The custom colors to show, with text nudged until it reads: null when none are saved or they are not a palette. */
function customPalette(): Palette | null {
  return adjustedPalette(useSettings.getState().palette)
}

/** The custom theme's backdrop, or null for a flat palette background. */
function customBackground(): Background | null {
  return useSettings.getState().background
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

/** Shows a theme, and over it the custom colors and backdrop when there are any (tokens.css mixes the rest). */
function apply(theme: Theme, palette: Palette | null = null, background: Background | null = null) {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.classList.toggle('light', theme === 'light')
  for (const name of Object.keys(customVars(DARK_PALETTE))) root.style.removeProperty(name)
  root.style.removeProperty('--hb-border')
  root.style.removeProperty('--hb-border-strong')
  root.style.removeProperty('--hb-bg-image')
  if (palette && background?.kind === 'photo') root.dataset.photo = background.id
  else delete root.dataset.photo
  if (palette) {
    const borders = borderColors(useSettings.getState())
    if (borders?.border) root.style.setProperty('--hb-border', borders.border)
    if (borders?.borderStrong) root.style.setProperty('--hb-border-strong', borders.borderStrong)
    for (const [name, value] of Object.entries(customVars(palette))) root.style.setProperty(name, value)
    if (background) root.style.setProperty('--hb-bg-image', backgroundImageCss(background, palette))
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
function reveal(theme: Theme, palette: Palette | null, background: Background | null = null, origin?: { x: number; y: number }) {
  const root = document.documentElement
  const still = root.dataset.motion === 'still' || (root.dataset.motion !== 'lively' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  if (still) return apply(theme, palette, background)

  if (!document.startViewTransition) {
    // No view transitions here: let every color ease to its new value instead.
    root.dataset.themeFade = ''
    apply(theme, palette, background)
    setTimeout(() => delete root.dataset.themeFade, REVEAL_MS)
    return
  }

  const x = origin?.x ?? innerWidth / 2
  const y = origin?.y ?? 0
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  root.dataset.themeReveal = ''
  const transition = document.startViewTransition(() => apply(theme, palette, background))
  void transition.ready.then(() => {
    root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: REVEAL_MS, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', pseudoElement: '::view-transition-new(root)' },
    )
  })
  void transition.finished.finally(() => delete root.dataset.themeReveal)
}

/** How long a picked theme waits for the host to open from where it was picked. Later than that, it just shows. */
const PICK_WAIT_MS = 1500
/** Where the user picked a kept theme, so it opens from there once the host sends it back. */
let pickedAt: { x: number; y: number; until: number } | null = null

/**
 * Puts a kept custom theme back on. The host keeps which one is on, so the window shows it when the host sends it and
 * a restart keeps it. Pass where it was picked, so it opens from there. False when the host could not.
 */
export async function pickKeptTheme(id: string, origin?: { x: number; y: number }): Promise<boolean> {
  pickedAt = origin ? { ...origin, until: Date.now() + PICK_WAIT_MS } : null
  try {
    await runCommand('appearance.pick', { id })
    return true
  } catch {
    pickedAt = null
    return false
  }
}

/**
 * Sets what the user chose: light, dark, follow the Mac, or custom. Pass where the control is, so the new theme
 * opens from it. Picking a base theme drops the custom colors here, and the host is told so its next start shows the
 * base too; the host still keeps the custom theme in its list. Custom brings back the kept theme shown last, and only
 * with nothing kept does it start from the colors showing now.
 */
export function setThemeChoice(next: ThemeChoice, origin?: { x: number; y: number }) {
  const host = hostStore.getState()
  const kept = next === 'custom' && !customPalette() && host.link === 'open' ? themeToRestore(host.themes) : null
  if (kept) {
    void pickKeptTheme(kept.id, origin).then((picked) => {
      if (!picked) showThemeChoice('custom', origin)
    })
    return
  }
  showThemeChoice(next, origin)
  tellHostTheme(next, { connected: host.link === 'open', run: runCommand })
}

/** Shows a choice in this window. A theme hobkin asked for comes here, since the host already knows it. */
function showThemeChoice(next: ThemeChoice, origin?: { x: number; y: number }) {
  const settings = useSettings.getState()
  if (next === 'custom') {
    // A fresh custom theme starts from the colors showing now, unnamed until hobkin gives it a title.
    if (!customPalette()) {
      settings.setPalette(current() === 'dark' ? DARK_PALETTE : LIGHT_PALETTE)
      useSettings.setState({ themeName: null })
    }
  } else {
    // Light, Dark and Follow the Mac drop the custom theme, so a restart keeps the base the user chose.
    useSettings.setState(BASE_THEME_SETTINGS)
  }
  const palette = next === 'custom' ? customPalette() : null
  const background = palette ? customBackground() : null
  const theme: Theme = palette ? baseOf(palette) : next === 'light' || next === 'dark' ? next : system.matches ? 'dark' : 'light'
  remember(next === 'system' ? null : theme)
  settings.setCustomTheme(palette !== null)
  const showingCustom = document.documentElement.dataset.palette === 'custom'
  if (theme !== current() || (palette !== null) !== showingCustom) reveal(theme, palette, background, origin)
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
const followMac = (event: MediaQueryListEvent) => {
  if (choice() === 'system') reveal(event.matches ? 'dark' : 'light', null)
}
system.addEventListener('change', followMac)

// Opacity and the custom colors apply as they change, without the reveal: they move in small steps.
const stopSettings = useSettings.subscribe((state, before) => {
  if (state.backgroundOpacity !== before.backgroundOpacity) showOpacity(state.backgroundOpacity)
  // hobkin put the app on a built-in theme: show it as a click on that choice would.
  if (state.requestedTheme && state.requestedTheme !== before.requestedTheme) {
    const requested = state.requestedTheme
    useSettings.setState({ requestedTheme: null })
    showThemeChoice(requested)
    return
  }
  const changed = state.palette !== before.palette || state.background !== before.background || state.border !== before.border || state.borderStrong !== before.borderStrong
  const palette = state.customTheme && changed ? customPalette() : null
  if (palette) {
    remember(baseOf(palette))
    // A kept theme the user picked opens from where they picked it, as a click on a theme choice does.
    const origin = pickedAt && Date.now() < pickedAt.until ? pickedAt : undefined
    pickedAt = null
    if (origin) reveal(baseOf(palette), palette, customBackground(), origin)
    else apply(baseOf(palette), palette, customBackground())
  } else if (
    state.appearanceHome !== before.appearanceHome &&
    before.customTheme &&
    !state.customTheme
  ) {
    apply(saved() ?? current(), null)
  }
})

const stopAppearance = watchAppearance(hostStore)
// A hot update starts these again, so the old ones go first and nothing is applied twice.
import.meta.hot?.dispose(() => {
  stopAppearance()
  stopSettings()
  system.removeEventListener('change', followMac)
})

// What was saved, before the first render. index.html has already put on the light or dark under it.
showOpacity(useSettings.getState().backgroundOpacity)
const startPalette = useSettings.getState().customTheme ? customPalette() : null
if (startPalette) apply(baseOf(startPalette), startPalette, customBackground())

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
