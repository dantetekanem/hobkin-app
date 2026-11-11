import { paletteProblems, type AppearanceRequest, type Palette } from '#shared/protocol/appearance.ts'

/**
 * The theme hobkin last set for the app (#50). The host only checks it and tells the window; the window applies it.
 * Each request gets a new id, so a window that reconnects does not apply one twice.
 */
export class Appearance {
  state: AppearanceRequest | null = null
  private readonly onChange: () => void

  constructor({ onChange }: { onChange: () => void }) {
    this.onChange = onChange
  }

  /** Throws in plain words when the text would not read, so hobkin can choose other colors. */
  set(palette: Palette, name?: string): { ok: true } {
    const problems = paletteProblems(palette)
    if (problems.length) throw Error(`${problems.join(' ')} Choose colors that read and run it again.`)
    this.state = { id: Math.max(Date.now(), (this.state?.id ?? 0) + 1), name: name?.trim() || null, palette }
    this.onChange()
    return { ok: true }
  }
}
