import { type AppearanceRequest, type Palette, adjustedPalette, asBackground, borderColors, contrast, luminance } from '#shared/protocol/appearance.ts'

export { PALETTE_KEYS, adjustedPalette, asBackground, backgroundImageCss, contrast, paletteProblems, readablePalette, type Background, type Palette } from '#shared/protocol/appearance.ts'

/** The rules behind the Settings tiles, apart from the page so they can be tested alone. See _specs/020-settings. */

/**
 * How many agents work mode may run together, for the window with no host: hobkin's own default and most
 * (`DEFAULT_AGENTS` and `MAX_AGENTS` in `src/cli/work/store.mjs`). With a host the most is the one it sends.
 */
export const AGENTS = { min: 1, max: 100, initial: 2 } as const

/** Tokens work mode may spend in a day. hobkin's default is 100M. */
export const BUDGET = { min: 10_000_000, max: 200_000_000, step: 10_000_000, initial: 100_000_000 } as const

/** Moves the budget by whole steps. A value between steps snaps to the nearest one first. */
export function stepBudget(current: number, delta: -1 | 0 | 1): number {
  const steps = Math.round((current - BUDGET.min) / BUDGET.step) + delta
  return Math.min(BUDGET.max, Math.max(BUDGET.min, BUDGET.min + steps * BUDGET.step))
}

/** 100000000 becomes "100M". */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`
  if (tokens >= 1_000) return `${Number((tokens / 1_000).toFixed(1))}K`
  return String(tokens)
}

/**
 * How much of hobkin's day is used, from the work status (`tokensToday` of `dailyTokens`). Null while hobkin has not
 * reported both, which is unknown and never zero. The bar stops at full; `reached` is when the day is used up.
 */
export function budgetUse(used: number | null, limit: number | null): { share: number; reached: boolean; line: string } | null {
  if (used === null || limit === null || !(limit > 0)) return null
  const reached = used >= limit
  const tail = reached ? 'Work mode starts nothing new until tomorrow.' : 'Work mode stops starting new work when the day is used up.'
  return { share: Math.min(1, Math.max(0, used / limit)), reached, line: `${formatTokens(used)} of ${formatTokens(limit)} used today. ${tail}` }
}

/** The kinds of tool block an agent's steps are drawn in (021-agent-rendering): code changes, commands, reads and searches, and every other tool. */
export type BlockKind = 'change' | 'shell' | 'looks' | 'other'

/** Which kinds of block are open when they arrive, until the user opens or closes one. None is: each shows its one-line header. */
export const OPEN_BY_DEFAULT: Readonly<Record<BlockKind, boolean>> = { change: false, shell: false, looks: false, other: false }

/** The first saved version in which code changes arrive closed. Older saves kept the old default as if it were a choice. */
const CHANGES_CLOSED_SINCE = 5

/** How much of the window's backgrounds and cards shows (#20). Text, icons and the focus ring always stay solid. */
export const OPACITY = { min: 0.1, max: 1, step: 0.05, initial: 1 } as const

/** Moves the opacity by whole steps and keeps it in range. A value that is not a number goes back to solid. */
export function stepOpacity(current: number, delta: -1 | 0 | 1): number {
  if (!Number.isFinite(current)) return OPACITY.initial
  const steps = Math.round((current - OPACITY.min) / OPACITY.step) + delta
  return Math.round(Math.min(OPACITY.max, Math.max(OPACITY.min, OPACITY.min + steps * OPACITY.step)) * 100) / 100
}

/** The built-in themes' five colors, as tokens.css has them. A custom theme starts from the one showing. */
export const LIGHT_PALETTE: Palette = { background: '#f0ead6', surface: '#f8f4e8', text: '#16181f', muted: '#5a5648', accent: '#ffc940' }
export const DARK_PALETTE: Palette = { background: '#0e0f13', surface: '#17191f', text: '#f0ead6', muted: '#a8a291', accent: '#ffc940' }

/** A custom theme sits on the dark theme when its text is lighter than its background: status and code colors follow. */
export function isDarkPalette(palette: Palette): boolean {
  return luminance(palette.text) > luminance(palette.background)
}

/** Black or white for text on the accent, whichever reads better. The better one is always above 4.5 to 1. */
export function onAccent(accent: string): string {
  return contrast(accent, '#000000') >= contrast(accent, '#ffffff') ? '#000000' : '#ffffff'
}

/** What main hobkin gets in its chat when Custom asks for a theme: the user's words, prefixed so it knows what they are for. */
export const themeRequestText = (text: string) => `Build a theme: ${text.trim()}`

/** The theme the app shows, for the choices Settings offers. `custom` carries the active custom theme's name. */
export type ActiveTheme =
  | { kind: 'light' | 'dark' | 'system' }
  | { kind: 'custom'; name: string | null }

/**
 * The name Settings shows for the theme in use: the custom theme's title (or "Custom" when it has none), or the base
 * theme's own name. `system` says which way the Mac is leaning right now so the label is never ambiguous.
 */
export function activeThemeLabel(active: ActiveTheme, systemTheme: 'light' | 'dark'): string {
  switch (active.kind) {
    case 'custom':
      return active.name ?? 'Custom'
    case 'light':
      return 'Light'
    case 'dark':
      return 'Dark'
    case 'system':
      return `Following the Mac, ${systemTheme} now`
  }
}

/**
 * The settings a base theme (Light, Dark or Follow the Mac) leaves behind. Choosing one drops the custom palette, its
 * backdrop and its name, so a restart keeps the base theme the user picked instead of bringing the custom one back.
 */
export const BASE_THEME_SETTINGS = { palette: null, background: null, themeName: null, border: undefined, borderStrong: undefined, customTheme: false } as const

/**
 * What changes when hobkin's theme arrives: the palette to show (its text nudged until it reads, its vibe kept), the
 * backdrop, and the id so the same theme is not applied twice. Null when it was applied already or it is not a palette.
 */
export function receiveAppearance(state: { appearanceId: number }, { id, name, palette, border, borderStrong, background, use }: AppearanceRequest) {
  // A built-in theme keeps the saved custom colors, so choosing Custom again brings them back.
  if (use) return id <= state.appearanceId ? null : { customTheme: false, appearanceId: id, requestedTheme: use }
  const adjusted = adjustedPalette(palette)
  const borders = borderColors({ border, borderStrong })
  if (id <= state.appearanceId || !adjusted || !borders) return null

  return {
    palette: adjusted,
    border: borders.border,
    borderStrong: borders.borderStrong,
    background: asBackground(background),
    themeName: name?.trim() || null,
    customTheme: true,
    appearanceId: id,
  }
}

/** Settings saved before version 2 gain background opacity and the custom theme (what cannot be used is dropped). The theme ask older versions kept is dropped. A saved palette is nudged to read; an unusable backdrop is dropped. */
export function migrateSettings(saved: unknown, from = 0): Record<string, unknown> {
  const state = typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>) : {}
  const kinds = state.openByDefault
  const closedChanges = from < CHANGES_CLOSED_SINCE && typeof kinds === 'object' && kinds !== null ? { openByDefault: { ...kinds, change: false } } : {}
  const palette = adjustedPalette(state.palette)
  const opacity = typeof state.backgroundOpacity === 'number' && state.backgroundOpacity <= OPACITY.max ? state.backgroundOpacity : OPACITY.initial
  const borders = palette ? { ...borderColors({ border: state.border as string }), ...borderColors({ borderStrong: state.borderStrong as string }) } : {}
  const { border: _border, borderStrong: _strong, request: _request, background: _background, ...rest } = state
  const { themeName: _themeName, ...carried } = rest
  return {
    ...carried,
    ...closedChanges,
    ...borders,
    backgroundOpacity: stepOpacity(opacity, 0),
    palette,
    background: palette ? asBackground(state.background) : null,
    themeName: palette && typeof state.themeName === 'string' ? state.themeName : null,
    customTheme: state.customTheme === true && palette !== null,
    appearanceId: typeof state.appearanceId === 'number' ? state.appearanceId : 0,
  }
}
