/**
 * The custom theme's five colors and the rule that keeps their text readable. Shared so the host refuses an unreadable
 * theme from hobkin with the same words the window would (#50), and so hobkin can retry.
 */
/** The five colors a custom theme is made of (#50). tokens.css mixes the rest of the palette from them. */
export const PALETTE_KEYS = ['background', 'surface', 'text', 'muted', 'accent'] as const
export type Palette = Record<(typeof PALETTE_KEYS)[number], string>


/** A theme hobkin asked for. A new `id` is a new request, so the window applies each one once. */
export interface AppearanceRequest {
  id: number
  /** What hobkin calls the theme, or null. */
  name: string | null
  palette: Palette
}

/** Reading text needs 4.5 to 1 (WCAG AA). */
const READABLE = 4.5
const HEX = /^#[0-9a-f]{6}$/i

export function luminance(hex: string): number {
  const int = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [int >> 16, (int >> 8) & 255, int & 255].map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast between two #rrggbb colors, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

/** The palette as five lowercase #rrggbb colors and nothing else, or null when it is not one. */
export function asPalette(value: unknown): Palette | null {
  if (typeof value !== 'object' || value === null) return null
  const colors = PALETTE_KEYS.map((key) => (value as Record<string, unknown>)[key])
  if (!colors.every((color) => typeof color === 'string' && HEX.test(color))) return null
  return Object.fromEntries(PALETTE_KEYS.map((key, index) => [key, (colors[index] as string).toLowerCase()])) as Palette
}

/** Why a palette would leave text unreadable, in words. Empty when both text colors read on both backgrounds. */
export function paletteProblems(value: unknown): string[] {
  const palette = asPalette(value)
  if (!palette) return ['Each color must be a hex color such as #1a2b3c.']
  const problems: string[] = []
  for (const [fore, label] of [['text', 'Text'], ['muted', 'Muted text']] as const) {
    for (const [back, where] of [['background', 'the background'], ['surface', 'cards']] as const) {
      const ratio = contrast(palette[fore], palette[back])
      // Rounded down, so 4.48 never reads as a passing 4.5.
      if (ratio < READABLE) problems.push(`${label} on ${where} is ${Math.floor(ratio * 10) / 10} to 1. Reading needs ${READABLE}.`)
    }
  }
  return problems
}

/** The palette when every text color in it reads, otherwise null. */
export function readablePalette(value: unknown): Palette | null {
  const palette = asPalette(value)
  return palette && paletteProblems(palette).length === 0 ? palette : null
}
