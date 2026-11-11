import { type AppearanceRequest, type Palette, borderColors, contrast, luminance, readablePalette } from '#shared/protocol/appearance.ts'

export { PALETTE_KEYS, contrast, paletteProblems, readablePalette, type Palette } from '#shared/protocol/appearance.ts'

/** The rules behind the Settings tiles, apart from the page so they can be tested alone. See _specs/020-settings. */

/** How many agents work mode may run together. hobkin's own limits (`src/cli/work/store.mjs`). */
export const AGENTS = { min: 1, max: 8, initial: 2 } as const

/** Tokens work mode may spend in a day. hobkin's default is 100M. */
export const BUDGET = { min: 10_000_000, max: 200_000_000, step: 10_000_000, initial: 100_000_000 } as const

export function stepAgents(current: number, delta: -1 | 0 | 1): number {
  return Math.min(AGENTS.max, Math.max(AGENTS.min, Math.round(current) + delta))
}

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

/** The user's request for a custom theme, kept in Settings so the ask can be followed (#50). */
export interface ThemeAsk {
  text: string
  askedAt: number
  /** When a theme arrived for it, or null while hobkin has not answered. */
  appliedAt: number | null
  /** What hobkin called the theme it applied. */
  name: string | null
}

/** The message the chat gets, prefixed so hobkin knows what it is. */
export const themeRequestText = (text: string) => `Set a custom theme for me: ${text.trim()}`

export function themeAsk(text: string, at: number): ThemeAsk | null {
  return text.trim() ? { text: text.trim(), askedAt: at, appliedAt: null, name: null } : null
}

/** "Asked hobkin at 8:01 PM", then "Applied" once a theme arrived. */
export function askLine(ask: ThemeAsk): string {
  if (ask.appliedAt !== null) return ask.name ? `Applied: ${ask.name}` : 'Applied'
  return `Asked hobkin at ${new Date(ask.askedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

/**
 * What changes when hobkin's theme arrives: the palette to show, the ask marked applied, and the request remembered so it is not
 * applied twice. Null when it was applied already or its text would not read.
 */
export function receiveAppearance(
  state: { request: ThemeAsk | null; appearanceId: number },
  { id, name, palette, border, borderStrong }: AppearanceRequest,
  now: number,
) {
  const readable = readablePalette(palette)
  const borders = borderColors({ border, borderStrong })
  if (id <= state.appearanceId || !readable || !borders) return null
  const { request } = state
  return { palette: readable, border: borders.border, borderStrong: borders.borderStrong, customTheme: true, appearanceId: id, request: request && request.appliedAt === null ? { ...request, appliedAt: now, name } : request }
}

/** Settings saved before version 2 gain background opacity and the custom theme (what cannot be used is dropped), and before version 3 no ask. */
export function migrateSettings(saved: unknown): Record<string, unknown> {
  const state = typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>) : {}
  const palette = readablePalette(state.palette)
  const opacity = typeof state.backgroundOpacity === 'number' && state.backgroundOpacity <= OPACITY.max ? state.backgroundOpacity : OPACITY.initial
  const borders = palette ? { ...borderColors({ border: state.border as string }), ...borderColors({ borderStrong: state.borderStrong as string }) } : {}
  const { border: _border, borderStrong: _strong, ...rest } = state
  return { ...rest, ...borders, backgroundOpacity: stepOpacity(opacity, 0), palette, customTheme: state.customTheme === true && palette !== null, request: state.request ?? null, appearanceId: typeof state.appearanceId === 'number' ? state.appearanceId : 0 }
}
