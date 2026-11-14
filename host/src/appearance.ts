import { randomUUID } from 'node:crypto'
import { paletteProblems, type AppearanceRequest, type BuiltInTheme, type Palette } from '#shared/protocol/appearance.ts'
import type { KeptTheme, KeptThemes } from '#shared/protocol/theme-history.ts'
import { AppearanceFile } from './appearance-file.ts'
import { decodeAppearanceStyle, encodeAppearanceStyle, type AppearanceStyle } from './appearance-style.ts'
import {
  NO_THEMES,
  decodeThemeHistory,
  encodeThemeHistory,
  forgetTheme,
  keepTheme,
  keptThemes,
  photoTheme,
  renameTheme,
  wearTheme,
  type ThemeHistory,
} from './theme-history.ts'

/** A readable palette for a request that does not use one. */
const NEUTRAL: Palette = { background: '#0e0f13', surface: '#17191f', text: '#f0ead6', muted: '#a8a291', accent: '#ffc940' }

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * The theme hobkin last set for the app (#50), and every custom theme it made, kept newest first (020-settings).
 * With a canonical file, save before telling the window. Each request gets a new id, so a window that reconnects does
 * not apply one twice. `client/custom.css` is the theme on now and `client/themes.json` the kept ones, with their names.
 */
export class Appearance {
  state: AppearanceRequest | null = null
  style: AppearanceStyle | null = null
  private history: ThemeHistory = NO_THEMES
  private readonly onChange: () => void
  private readonly file?: AppearanceFile
  private readonly log: (line: string) => void
  private readonly now: () => Date

  constructor({ onChange, file, log = () => {}, now = () => new Date() }: { onChange: () => void; file?: AppearanceFile; log?: (line: string) => void; now?: () => Date }) {
    this.onChange = onChange
    this.file = file
    this.log = log
    this.now = now
  }

  load(): boolean {
    const file = this.canonical()
    this.history = this.readHistory(file)
    const content = file.read({})
    if (content === null) return false
    const style = decodeAppearanceStyle(content)
    // A theme saved before the list existed joins it, with the photo its file says.
    const theme = this.keep(style, {})
    const photo = file.readPhoto()
    if (photo !== (theme.photo ?? null)) this.commit(photoTheme(this.history, theme.id, photo))
    this.publish(style, theme.name)
    return true
  }

  readStyle(): string | null {
    return this.canonical().read({})
  }

  replaceStyle(args: unknown): { ok: true; appearanceId: number } {
    const style = decodeAppearanceStyle(this.canonical().replace(args))
    const theme = this.keep(style, {})
    this.wearPhoto(theme)
    return { ok: true, appearanceId: this.publish(style, theme.name) }
  }

  /** Throws in plain words when the text would not read, so hobkin can choose other colors. `asked` is the user's own words for it. */
  set(palette: Palette, name?: string, asked?: string): { ok: true } {
    const problems = paletteProblems(palette)
    if (problems.length) throw Error(`${problems.join(' ')} Choose colors that read and run it again.`)
    const content = encodeAppearanceStyle({ palette })
    const style = decodeAppearanceStyle(this.file ? this.file.replace({ content }) : content)
    const theme = this.keep(style, { name, asked })
    this.wearPhoto(theme)
    this.publish(style, theme.name)
    return { ok: true }
  }

  /** The kept custom themes, newest first, which one was shown last and whether it is on now. */
  kept(): KeptThemes {
    return keptThemes(this.history, this.showing())
  }

  /** Puts a kept theme back on, with its name and photo. It stays where it is in the list. */
  pick(id: string): { ok: true } {
    const { history, theme } = wearTheme(this.history, id)
    const content = encodeAppearanceStyle({
      palette: theme.palette,
      ...(theme.border ? { border: theme.border } : {}),
      ...(theme.borderStrong ? { borderStrong: theme.borderStrong } : {}),
    })
    const style = decodeAppearanceStyle(this.file ? this.file.replace({ content }) : content)
    this.commit(history)
    this.wearPhoto(theme)
    this.publish(style, theme.name)
    return { ok: true }
  }

  /** Renames a kept theme. Renaming the one on now changes the title the window shows. */
  rename(id: string, name: string): { ok: true } {
    this.commit(renameTheme(this.history, id, name))
    const theme = this.history.themes.find((kept) => kept.id === id)!
    if (this.style && this.showing() && this.history.worn === id) this.publish(this.style, theme.name)
    else this.onChange()
    return { ok: true }
  }

  /** Removes a kept theme. The one on now is refused, so the window never loses what it shows. */
  remove(id: string): { ok: true } {
    this.commit(forgetTheme(this.history, id, { showing: this.showing() }))
    this.onChange()
    return { ok: true }
  }

  /** Selects an application-owned raster, never a path or URL; the palette-only child cannot call this. The photo belongs to the theme on now. */
  photo(id: 'milky-way' | null): { ok: true } {
    if (id !== null && id !== 'milky-way') throw new Error('Only the bundled Milky Way photo or null is accepted.')
    if (!this.style || this.state?.use) throw new Error('Choose a custom theme before selecting its photo.')
    if (!this.file) throw new Error('Canonical appearance file is not configured.')
    this.file.replacePhoto(id)
    if (this.history.worn) this.commit(photoTheme(this.history, this.history.worn, id))
    this.publish(this.style, this.state?.name)
    return { ok: true }
  }

  /**
   * Puts the app back on a built-in theme, and a restart keeps it there. The custom theme stays in the kept list, so
   * choosing Custom brings it back. The palette sent along is ignored by the window.
   */
  use(theme: BuiltInTheme): { ok: true } {
    const palette = this.style?.palette ?? NEUTRAL
    this.file?.remove()
    this.style = null
    this.state = { id: Math.max(Date.now(), (this.state?.id ?? 0) + 1), name: null, palette, use: theme }
    this.onChange()
    return { ok: true }
  }

  private canonical(): AppearanceFile {
    if (!this.file) throw new Error('Canonical appearance file is not configured.')
    return this.file
  }

  /** A custom theme is on: the last one shown, not a built-in. */
  private showing(): boolean {
    return this.style !== null && this.state !== null && !this.state.use
  }

  /** The kept list from its file. One that cannot be read is said, and the list starts again rather than stop the theme. */
  private readHistory(file: AppearanceFile): ThemeHistory {
    try {
      const text = file.readThemes()
      return text === null ? NO_THEMES : decodeThemeHistory(text)
    } catch (error) {
      // A home not made yet has no list either, and nothing to say about it.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.log(`Could not read the kept themes, so their list starts again: ${reason(error)}`)
      return NO_THEMES
    }
  }

  private newId(): string {
    for (;;) {
      const id = randomUUID().slice(0, 8)
      if (!this.history.themes.some((theme) => theme.id === id)) return id
    }
  }

  private keep(style: AppearanceStyle, made: { name?: string; asked?: string }): KeptTheme {
    const { history, theme } = keepTheme(this.history, style, { id: this.newId(), at: this.now().toISOString(), ...made })
    this.commit(history)
    return theme
  }

  /** Holds the new list and saves it when it changed. A list that cannot be saved is said, and the theme still shows. */
  private commit(history: ThemeHistory): void {
    const before = this.history
    this.history = history
    if (!this.file) return
    const content = encodeThemeHistory(history)
    if (content === encodeThemeHistory(before)) return
    try {
      this.file.replaceThemes(content)
    } catch (error) {
      this.log(`Could not save the kept themes: ${reason(error)}`)
    }
  }

  /** The photo file follows the theme put on: its own photo, or none. */
  private wearPhoto(theme: KeptTheme): void {
    if (!this.file) return
    const photo = theme.photo ?? null
    if (this.file.readPhoto() !== photo) this.file.replacePhoto(photo)
  }

  private publish(style: AppearanceStyle, name?: string | null): number {
    const photo = this.file?.readPhoto()
    this.style = style
    this.state = {
      id: Math.max(Date.now(), (this.state?.id ?? 0) + 1),
      name: name?.trim() || null,
      palette: style.palette,
      ...(photo ? { background: { kind: 'photo', id: photo } as const } : {}),
    }
    const id = this.state.id
    this.onChange()
    return id
  }
}
