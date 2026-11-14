import { borderColors, readablePalette } from '#shared/protocol/appearance.ts'
import { KEPT_ASKED_MAX, KEPT_ID_PATTERN, KEPT_NAME_MAX, KEPT_THEMES_MAX, type KeptTheme, type KeptThemes } from '#shared/protocol/theme-history.ts'
import type { AppearanceStyle } from './appearance-style.ts'

/**
 * The rules of the kept custom themes (020-settings), apart from the files so they can be tested alone. Every function
 * returns a new history and leaves the one it was given as it was. `client/themes.json` holds what they return.
 */
export interface ThemeHistory {
  /** The kept theme shown last, or null. */
  worn: string | null
  /** Newest first, at most `KEPT_THEMES_MAX`. */
  themes: KeptTheme[]
}

export const NO_THEMES: ThemeHistory = { worn: null, themes: [] }

const ID = new RegExp(KEPT_ID_PATTERN)

/** Words on one line: control characters and runs of space become one space, cut to `max` characters. Null when nothing is left. */
function cleanWords(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const words = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return words ? [...words].slice(0, max).join('') : null
}

/** The same five colors and the same borders. */
function sameColors(theme: KeptTheme, style: AppearanceStyle): boolean {
  return (
    Object.entries(style.palette).every(([key, color]) => theme.palette[key as keyof typeof theme.palette] === color) &&
    theme.border === style.border &&
    theme.borderStrong === style.borderStrong
  )
}

function find(history: ThemeHistory, id: string): KeptTheme {
  const theme = history.themes.find((kept) => kept.id === id)
  if (!theme) throw Error(`No kept theme has the id ${id}. appearance.themes lists them.`)
  return theme
}

function replace(history: ThemeHistory, theme: KeptTheme): KeptTheme[] {
  return history.themes.map((kept) => (kept.id === theme.id ? theme : kept))
}

/** The kept theme with these colors, if there is one. */
export function findColors(history: ThemeHistory, style: AppearanceStyle): KeptTheme | undefined {
  return history.themes.find((theme) => sameColors(theme, style))
}

/**
 * Keeps a theme hobkin made and wears it. Colors already kept wear that theme where it is, taking a new name or words
 * when they come. New colors go first, and the oldest goes when that makes more than `KEPT_THEMES_MAX`.
 */
export function keepTheme(
  history: ThemeHistory,
  style: AppearanceStyle,
  made: { id: string; at: string; name?: string | null; asked?: string | null },
): { history: ThemeHistory; theme: KeptTheme } {
  const name = cleanWords(made.name, KEPT_NAME_MAX)
  const asked = cleanWords(made.asked, KEPT_ASKED_MAX)
  const existing = findColors(history, style)
  if (existing) {
    const theme = { ...existing, name: name ?? existing.name, asked: asked ?? existing.asked }
    return { history: { worn: theme.id, themes: replace(history, theme) }, theme }
  }
  const theme: KeptTheme = {
    id: made.id,
    name,
    asked,
    palette: { ...style.palette },
    ...(style.border ? { border: style.border } : {}),
    ...(style.borderStrong ? { borderStrong: style.borderStrong } : {}),
    at: made.at,
  }
  return { history: { worn: theme.id, themes: [theme, ...history.themes].slice(0, KEPT_THEMES_MAX) }, theme }
}

/** Wears a kept theme again. It stays where it is in the list. */
export function wearTheme(history: ThemeHistory, id: string): { history: ThemeHistory; theme: KeptTheme } {
  const theme = find(history, id)
  return { history: { ...history, worn: id }, theme }
}

export function renameTheme(history: ThemeHistory, id: string, name: string): ThemeHistory {
  const clean = cleanWords(name, KEPT_NAME_MAX)
  if (!clean) throw Error('Give the theme a name with at least one letter in it.')
  return { ...history, themes: replace(history, { ...find(history, id), name: clean }) }
}

/** Sets or clears the bundled photo behind one kept theme. */
export function photoTheme(history: ThemeHistory, id: string, photo: 'milky-way' | null): ThemeHistory {
  const { photo: _photo, ...theme } = find(history, id)
  return { ...history, themes: replace(history, photo ? { ...theme, photo } : theme) }
}

/** Removes a kept theme. The one on now stays until another theme is put on, so the window never loses what it shows. */
export function forgetTheme(history: ThemeHistory, id: string, { showing }: { showing: boolean }): ThemeHistory {
  find(history, id)
  if (showing && history.worn === id) throw Error('That theme is on now. Put another theme on first, then remove this one.')
  return { worn: history.worn === id ? null : history.worn, themes: history.themes.filter((theme) => theme.id !== id) }
}

/** What the window and hobkin read. `showing` is true only while a kept theme is on. */
export function keptThemes(history: ThemeHistory, showing: boolean): KeptThemes {
  return { themes: history.themes, worn: history.worn, showing: showing && history.worn !== null }
}

export function encodeThemeHistory(history: ThemeHistory): string {
  return `${JSON.stringify({ version: 1, worn: history.worn, themes: history.themes }, null, 2)}\n`
}

/** One kept theme from the file, checked as strictly as a theme from hobkin, or null when any part of it is not. */
function decodeTheme(value: unknown): KeptTheme | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const entry = value as Record<string, unknown>
  const palette = readablePalette(entry.palette)
  const borders = borderColors({ border: entry.border as string | undefined, borderStrong: entry.borderStrong as string | undefined })
  const at = typeof entry.at === 'string' ? Date.parse(entry.at) : Number.NaN
  if (typeof entry.id !== 'string' || !ID.test(entry.id) || !palette || !borders || Number.isNaN(at)) return null
  if (entry.photo !== undefined && entry.photo !== 'milky-way') return null
  return {
    id: entry.id,
    name: cleanWords(entry.name, KEPT_NAME_MAX),
    asked: cleanWords(entry.asked, KEPT_ASKED_MAX),
    palette,
    ...(borders.border ? { border: borders.border } : {}),
    ...(borders.borderStrong ? { borderStrong: borders.borderStrong } : {}),
    ...(entry.photo === 'milky-way' ? { photo: 'milky-way' as const } : {}),
    at: new Date(at).toISOString(),
  }
}

/** The history in `client/themes.json`. A damaged entry is left out, not the whole list. Throws when the file is not a history at all. */
export function decodeThemeHistory(text: string): ThemeHistory {
  const file = JSON.parse(text) as { version?: unknown; worn?: unknown; themes?: unknown }
  if (typeof file !== 'object' || file === null || file.version !== 1 || !Array.isArray(file.themes)) {
    throw Error('Not a kept themes file of version 1.')
  }
  const themes: KeptTheme[] = []
  for (const value of file.themes) {
    const theme = decodeTheme(value)
    if (theme && !themes.some(({ id }) => id === theme.id)) themes.push(theme)
  }
  const kept = themes.slice(0, KEPT_THEMES_MAX)
  const worn = typeof file.worn === 'string' && kept.some(({ id }) => id === file.worn) ? file.worn : null
  return { worn, themes: kept }
}
