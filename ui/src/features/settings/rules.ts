import { type AppearanceRequest, type Palette, borderColors, contrast, luminance, readablePalette } from '#shared/protocol/appearance.ts'
import type { ThemeOperation } from '#shared/commands/registry.ts'

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

/** What main hobkin gets in its chat when Custom asks for a theme: the user's words, prefixed so it knows what they are for. */
export const themeRequestText = (text: string) => `Build a theme: ${text.trim()}`

/** The user's request for a custom theme, kept in Settings so the ask can be followed (#50). */
export interface ThemeAsk {
  text: string
  askedAt: number
  home: string | null
  phase: 'pending' | 'known' | 'unknown'
  /** Only an acknowledged operation can identify this ask's canonical save. */
  operation: ThemeOperation | null
}

export function themeAsk(text: string, at: number): ThemeAsk | null {
  const request = text.trim()
  if (!request || request.length > 4000) return null
  return {
    text: request,
    askedAt: at,
    home: null,
    phase: 'pending',
    operation: null,
  }
}

export function askLine(ask: ThemeAsk): string {
  const operation = ask.operation
  const saved = operation?.appearanceId != null ? `Saved theme #${operation.appearanceId}. ` : 'No saved theme confirmed. '
  if (ask.phase === 'pending') return 'Requesting a theme…'
  if (ask.phase === 'unknown' || !operation) {
    const next = operation ? 'Refresh to check this operation.' : 'No acknowledgement received; do not resend automatically.'
    return `${saved}Operation status unknown. ${next}`
  }
  const completed = operation.status === 'completed'
    && operation.appearanceId !== null
    && operation.cleanup === 'confirmed'
  const status = operation.status === 'completed' && !completed ? 'unknown' : operation.status
  return `${saved}Last receipt: theme child ${status}; cleanup ${operation.cleanup}.${operation.error ? ` ${operation.error}` : ''}`
}

/** Canonical publications apply colors, but never establish which helper ask saved them. */
export function receiveAppearance(
  state: { request: ThemeAsk | null; appearanceId: number },
  { id, palette, border, borderStrong }: AppearanceRequest,
  _now?: number,
) {
  const readable = readablePalette(palette)
  const borders = borderColors({ border, borderStrong })
  if (id <= state.appearanceId || !readable || !borders) return null
  const { request } = state
  return { palette: readable, border: borders.border, borderStrong: borders.borderStrong, customTheme: true, appearanceId: id, request }
}

/** Legacy chat asks have no operation identity. Interrupted submissions must not be replayed. */
function migrateThemeAsk(value: unknown): ThemeAsk | null {
  if (!value || typeof value !== 'object' || !('text' in value) || typeof value.text !== 'string') return null
  const ask = themeAsk(value.text, 'askedAt' in value && typeof value.askedAt === 'number' ? value.askedAt : 0)
  return ask ? { ...ask, phase: 'unknown' } : null
}

/** Older settings retain their usable colors and opacity, without inventing operation authority. */
export function migrateSettings(saved: unknown): Record<string, unknown> {
  const state = typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>) : {}
  const palette = readablePalette(state.palette)
  const opacity = typeof state.backgroundOpacity === 'number' && state.backgroundOpacity <= OPACITY.max ? state.backgroundOpacity : OPACITY.initial
  const borders = palette ? { ...borderColors({ border: state.border as string }), ...borderColors({ borderStrong: state.borderStrong as string }) } : {}
  const { border: _border, borderStrong: _strong, ...rest } = state
  return {
    ...rest,
    ...borders,
    backgroundOpacity: stepOpacity(opacity, 0),
    palette,
    customTheme: state.customTheme === true && palette !== null,
    request: migrateThemeAsk(state.request),
    appearanceId: typeof state.appearanceId === 'number' ? state.appearanceId : 0,
  }
}
