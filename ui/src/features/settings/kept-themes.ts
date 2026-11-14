import { borderColors, readablePalette, type Palette } from '#shared/protocol/appearance.ts'
import type { KeptTheme, KeptThemes } from '#shared/protocol/theme-history.ts'

/** The kept custom themes as Settings shows them (020-settings). The host keeps them; these rules only read. */

/** The theme Custom brings back: the one shown last, or the newest when that one was removed. Null when none are kept. */
export function themeToRestore(kept: KeptThemes | null | undefined): KeptTheme | null {
  if (!kept?.themes.length) return null
  return kept.themes.find(({ id }) => id === kept.worn) ?? kept.themes[0]!
}

/** One kept theme ready to draw: its colors checked again before any reaches a style, and whether it is the one on. */
export interface ThemeSwatch {
  id: string
  title: string
  /** The user's words, when they differ from the title. */
  asked: string | null
  at: string
  palette: Palette
  border?: string
  photo: boolean
  on: boolean
}

/**
 * The kept themes, newest first, for the Custom part of Settings. One whose colors are not readable hex colors is
 * left out. `customOn` is whether the window shows a custom theme now, so a theme the host still wears under a
 * built-in choice is not marked as on.
 */
export function themeSwatches(kept: KeptThemes | null | undefined, customOn: boolean): ThemeSwatch[] {
  return (kept?.themes ?? []).flatMap((theme) => {
    const palette = readablePalette(theme.palette)
    const borders = borderColors({ border: theme.border, borderStrong: theme.borderStrong })
    if (!palette || !borders) return []
    const title = theme.name ?? theme.asked ?? 'Custom theme'
    return [{
      id: theme.id,
      title,
      asked: theme.asked && theme.asked !== title ? theme.asked : null,
      at: theme.at,
      palette,
      ...(borders.border ? { border: borders.border } : {}),
      photo: theme.photo === 'milky-way',
      on: customOn && kept!.showing && kept!.worn === theme.id,
    }]
  })
}

/** When a theme was made, in a few words: "Today", "Yesterday", or the day of the month. */
export function themeDay(at: string, now = new Date()): string {
  const made = new Date(at)
  if (Number.isNaN(made.getTime())) return ''
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((day(now) - day(made)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  const sameYear = made.getFullYear() === now.getFullYear()
  return made.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}
