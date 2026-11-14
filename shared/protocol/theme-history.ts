import type { BorderColors, Palette } from './appearance.ts'

/**
 * The custom themes the app keeps (020-settings). Every theme hobkin makes joins the list, newest first, so the user
 * can put an earlier one back on from Settings or by asking hobkin. The host keeps it beside the active theme.
 */

/** How many custom themes are kept. A new one past this pushes the oldest out. */
export const KEPT_THEMES_MAX = 12
/** A kept theme's name, at most. The same as `appearance.set` takes. */
export const KEPT_NAME_MAX = 60
/** The user's own words for a theme, at most. */
export const KEPT_ASKED_MAX = 200
/** A kept theme's id: eight lowercase hex digits. */
export const KEPT_ID_PATTERN = '^[0-9a-f]{8}$'

/** One custom theme hobkin made. */
export interface KeptTheme extends BorderColors {
  id: string
  /** What hobkin called it, or what the user renamed it to. Null for an unnamed one. */
  name: string | null
  /** What the user asked for, in their words, when hobkin passed them on. */
  asked: string | null
  palette: Palette
  /** The bundled photo behind this theme, when one was chosen for it. */
  photo?: 'milky-way'
  /** When it was made, as an ISO date. */
  at: string
}

/** The kept themes as the window and hobkin read them. */
export interface KeptThemes {
  /** Newest first. */
  themes: KeptTheme[]
  /** The kept theme shown last. It stays while a built-in theme shows, so choosing Custom brings it back. */
  worn: string | null
  /** The worn theme is on now. False while a built-in theme shows. */
  showing: boolean
}
