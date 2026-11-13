/**
 * The custom theme's five colors and the rule that keeps their text readable. Shared so the host refuses an unreadable
 * theme from hobkin with the same words the window would (#50), and so hobkin can retry.
 */
/** The five colors a custom theme is made of (#50). tokens.css mixes the rest of the palette from them. */
export const PALETTE_KEYS = ['background', 'surface', 'text', 'muted', 'accent'] as const
export type Palette = Record<(typeof PALETTE_KEYS)[number], string>


/** A theme hobkin asked for. A new `id` is a new request, so the window applies each one once. */
export interface BorderColors {
  border?: string
  borderStrong?: string
}

/**
 * An optional backdrop behind the window (#50). A gradient is a validated CSS `<gradient>`; an image is an https or
 * data-image URL; a photo is a fixed, locally bundled raster ID. Absent means the palette's flat background, as before.
 * Only values that pass `asBackground` ever
 * reach a style, so the raw string never touches the DOM unchecked.
 */
export type Background =
  | { kind: 'gradient'; value: string }
  | { kind: 'image'; url: string }
  | { kind: 'photo'; id: 'milky-way' }

/** Application-owned raster. Selecting it admits no user path, URL or image bytes. */
export const MILKY_WAY_PHOTO = {
  url: '/photos/milky-way.jpg',
  credit: 'ESO/S. Brunier',
  source: 'https://www.eso.org/public/images/eso0932a/',
  license: 'https://creativecommons.org/licenses/by/4.0/',
} as const

/** The themes the app has of its own: follow the Mac's light or dark setting, or stay light, or stay dark. */
export const BUILT_IN_THEMES = ['system', 'light', 'dark'] as const
export type BuiltInTheme = (typeof BUILT_IN_THEMES)[number]

export interface AppearanceRequest extends BorderColors {
  id: number
  /** Set when hobkin put the app back on a built-in theme. The window then ignores the palette and the backdrop. */
  use?: BuiltInTheme
  /** What hobkin calls the theme, or null. */
  name: string | null
  palette: Palette
  /** A backdrop behind the window, or absent for the flat palette background. */
  background?: Background
}

/** Reading text needs 4.5 to 1 (WCAG AA). */
const READABLE = 4.5
const HEX = /^#[0-9a-f]{6}$/i

/** Only literal border colors may reach inline properties or the first-paint cache. */
export function borderColors(value: BorderColors): BorderColors | null {
  const result: BorderColors = {}
  for (const key of ['border', 'borderStrong'] as const) {
    const color = value[key]
    if (color === undefined) continue
    if (typeof color !== 'string' || !HEX.test(color)) return null
    result[key] = color.toLowerCase()
  }
  return result
}

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

/** A #rrggbb color as its three 0–255 channels. */
function channels(hex: string): [number, number, number] {
  const int = Number.parseInt(hex.slice(1), 16)
  return [int >> 16, (int >> 8) & 255, int & 255]
}

/** A #rrggbb color `share` of the way from `from` to `to`, in sRGB. */
function mix(from: string, to: string, share: number): string {
  const [a, b] = [channels(from), channels(to)]
  const hex = a
    .map((value, index) => {
      const mixed = Math.round(value + (b[index]! - value) * share)
      return Math.min(255, Math.max(0, mixed)).toString(16).padStart(2, '0')
    })
    .join('')
  return `#${hex}`
}

/**
 * A readable version of `fore`, keeping as much of its hue as it can. When it already reads on every background it is
 * returned untouched; otherwise it is blended toward white or black, whichever reaches 4.5 to 1 with the smallest
 * change. If nothing reaches it (a background between the two), the blend that comes closest wins, so text never vanishes.
 */
function readableInk(fore: string, backs: string[]): string {
  const lowest = (color: string) => Math.min(...backs.map((back) => contrast(color, back)))
  if (lowest(fore) >= READABLE) return fore
  let best = { color: fore, score: lowest(fore) }
  const passes: { color: string; share: number }[] = []
  for (const target of ['#ffffff', '#000000']) {
    for (let step = 1; step <= 100; step++) {
      const share = step / 100
      const color = mix(fore, target, share)
      const score = lowest(color)
      if (score > best.score) best = { color, score }
      if (score >= READABLE) {
        passes.push({ color, share })
        break
      }
    }
  }
  // The smallest blend that passes keeps the hue closest; fall back to the best effort when none does.
  return passes.sort((a, b) => a.share - b.share)[0]?.color ?? best.color
}

/**
 * The palette with its text and muted colors nudged until they read on the background and cards, keeping every other
 * color — background, surface and accent — exactly as asked. Null only when the value is not five hex colors. This is
 * how a vivid theme survives: the vibe stays, the words stay readable, instead of the whole theme being thrown away.
 */
export function adjustedPalette(value: unknown): Palette | null {
  const palette = asPalette(value)
  if (!palette) return null
  const backs = [palette.background, palette.surface]
  return { ...palette, text: readableInk(palette.text, backs), muted: readableInk(palette.muted, backs) }
}

const GRADIENT = /^(repeating-)?(linear|radial|conic)-gradient\([a-z0-9#%.,()\s-]+\)$/
const IMAGE_URL = /^https:\/\/[^\s"'()\\<>]+$/
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=]+$/i
const BACKGROUND_MAX = 2_000_000

/** Rejects anything that could break out of a gradient value: other CSS functions and unbalanced parentheses. */
function safeGradient(value: string): boolean {
  if (/var\(|url\(|image\(|element\(|expression|@import|\/\*/.test(value)) return false
  let depth = 0
  for (const char of value) {
    if (char === '(') depth++
    else if (char === ')' && --depth < 0) return false
  }
  return depth === 0
}

/**
 * A backdrop as a validated shape, or null. A gradient must be one CSS `<gradient>` built from colors, stops and the
 * keywords gradients use — never another function or a stray brace. An image must be an https or base64 data-image URL
 * (SVG is refused, since it can carry script). A local photo accepts only its bundled ID. Only the result reaches a style.
 */
export function asBackground(value: unknown): Background | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (record.kind === 'photo') {
    return record.id === 'milky-way' && Object.keys(record).length === 2 ? { kind: 'photo', id: 'milky-way' } : null
  }
  if (record.kind === 'gradient') {
    const gradient = typeof record.value === 'string' ? record.value.trim().toLowerCase() : ''
    if (!gradient || gradient.length > BACKGROUND_MAX || !GRADIENT.test(gradient) || !safeGradient(gradient)) return null
    return { kind: 'gradient', value: gradient }
  }
  if (record.kind === 'image') {
    const url = typeof record.url === 'string' ? record.url.trim() : ''
    if (!url || url.length > BACKGROUND_MAX || !(IMAGE_URL.test(url) || DATA_IMAGE.test(url))) return null
    return { kind: 'image', url }
  }
  return null
}

/** The validated backdrop as a CSS `<image>` ready for `background-image`. Safe because `asBackground` vetted it. */
export function backgroundImageCss(background: Background, palette?: Palette): string {
  if (background.kind === 'photo') {
    if (!palette || !readablePalette(palette)) return 'none'
    // Bound every photo pixel between black and white. Increase the solid scrim until both inks read over either.
    let opacity = 1
    for (let percent = 65; percent <= 100; percent++) {
      const backs = ['#000000', '#ffffff'].map(pixel => mix(pixel, palette.background, percent / 100))
      if (backs.every(back => contrast(palette.text, back) >= READABLE && contrast(palette.muted, back) >= READABLE)) {
        opacity = percent / 100
        break
      }
    }
    const color = `rgb(${channels(palette.background).join(' ')} / ${opacity})`
    return `linear-gradient(${color}, ${color}), url("${MILKY_WAY_PHOTO.url}")`
  }
  return background.kind === 'gradient' ? background.value : `url("${background.url}")`
}
