import { paletteProblems, type AppearanceRequest, type BuiltInTheme, type Palette } from '#shared/protocol/appearance.ts'
import { AppearanceFile } from './appearance-file.ts'
import { decodeAppearanceStyle, encodeAppearanceStyle, type AppearanceStyle } from './appearance-style.ts'

/** A readable palette for a request that does not use one. */
const NEUTRAL: Palette = { background: '#0e0f13', surface: '#17191f', text: '#f0ead6', muted: '#a8a291', accent: '#ffc940' }

/**
 * The theme hobkin last set for the app (#50). With a canonical file, save before telling the window.
 * Each request gets a new id, so a window that reconnects does not apply one twice.
 */
export class Appearance {
  state: AppearanceRequest | null = null
  style: AppearanceStyle | null = null
  private readonly onChange: () => void
  private readonly file?: AppearanceFile

  constructor({ onChange, file }: { onChange: () => void; file?: AppearanceFile }) {
    this.onChange = onChange
    this.file = file
  }

  load(): boolean {
    if (!this.file) throw new Error('Canonical appearance file is not configured.')
    const content = this.file.read({})
    if (content === null) return false
    this.publish(decodeAppearanceStyle(content))
    return true
  }

  readStyle(): string | null {
    if (!this.file) throw new Error('Canonical appearance file is not configured.')
    return this.file.read({})
  }

  replaceStyle(args: unknown): { ok: true; appearanceId: number } {
    if (!this.file) throw new Error('Canonical appearance file is not configured.')
    return { ok: true, appearanceId: this.publish(decodeAppearanceStyle(this.file.replace(args))) }
  }

  /** Throws in plain words when the text would not read, so hobkin can choose other colors. */
  set(palette: Palette, name?: string): { ok: true } {
    const problems = paletteProblems(palette)
    if (problems.length) throw Error(`${problems.join(' ')} Choose colors that read and run it again.`)
    const content = encodeAppearanceStyle({ palette })
    const style = decodeAppearanceStyle(this.file ? this.file.replace({ content }) : content)
    this.publish(style, name)
    return { ok: true }
  }

  /** Puts the app back on a built-in theme and forgets the saved custom one. The palette sent along is ignored by the window. */
  use(theme: BuiltInTheme): { ok: true } {
    const palette = this.style?.palette ?? NEUTRAL
    this.file?.remove()
    this.style = null
    this.state = { id: Math.max(Date.now(), (this.state?.id ?? 0) + 1), name: null, palette, use: theme }
    this.onChange()
    return { ok: true }
  }

  private publish(style: AppearanceStyle, name?: string): number {
    this.style = style
    this.state = {
      id: Math.max(Date.now(), (this.state?.id ?? 0) + 1),
      name: name?.trim() || null,
      palette: style.palette,
    }
    const id = this.state.id
    this.onChange()
    return id
  }
}
