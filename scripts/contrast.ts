/**
 * Checks the palette in ui/src/styles/tokens.css against WCAG contrast, for both themes.
 * Run with `pnpm check:contrast`. Exits 1 when a pair falls short.
 *
 * Text needs 4.5 to 1. Large text and interface glyphs (icons, outlines, the focus ring) need 3 to 1.
 */
import { readFileSync } from 'node:fs'

type Rgb = [number, number, number]
type Lab = [number, number, number]
type Tokens = Map<string, string>

const TEXT = 4.5
const GLYPH = 3

const source = readFileSync(new URL('../ui/src/styles/tokens.css', import.meta.url), 'utf8')

function block(selector: string): Tokens {
  const start = source.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`tokens.css has no "${selector}" block`)
  const body = source.slice(source.indexOf('{', start) + 1, source.indexOf('\n}', start))
  const tokens: Tokens = new Map()
  for (const [, name, value] of body.matchAll(/(--hb-[\w-]+):\s*([^;]+);/g)) tokens.set(name!, value!.trim())
  return tokens
}

const toLinear = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
const toGamma = (channel: number) => (channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055)

function linearToLab([r, g, b]: Rgb): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function labToLinear([L, a, b]: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** Resolves a token value to linear sRGB. Handles hex, oklch(), var() and color-mix(in oklab, A p%, B). */
function resolve(value: string, tokens: Tokens): Rgb {
  const text = value.trim()

  const hex = /^#([0-9a-f]{6})$/i.exec(text)
  if (hex) {
    const int = Number.parseInt(hex[1]!, 16)
    return [toLinear(((int >> 16) & 255) / 255), toLinear(((int >> 8) & 255) / 255), toLinear((int & 255) / 255)]
  }

  const oklch = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(text)
  if (oklch) {
    const [L, C, h] = [Number(oklch[1]), Number(oklch[2]), (Number(oklch[3]) * Math.PI) / 180]
    return labToLinear([L, C * Math.cos(h), C * Math.sin(h)])
  }

  const reference = /^var\((--hb-[\w-]+)\)$/.exec(text)
  if (reference) return resolve(lookup(reference[1]!, tokens), tokens)

  const mix = /^color-mix\(in oklab,\s*(.+?)\s+([\d.]+)%,\s*(.+)\)$/.exec(text)
  if (mix) {
    const share = Number(mix[2]) / 100
    const first = linearToLab(resolve(mix[1]!, tokens))
    const second = linearToLab(resolve(mix[3]!, tokens))
    return labToLinear(first.map((part, index) => part * share + second[index]! * (1 - share)) as Lab)
  }

  throw new Error(`cannot read the color "${value}"`)
}

function lookup(name: string, tokens: Tokens): string {
  const value = tokens.get(name)
  if (!value) throw new Error(`token ${name} is not defined`)
  return value
}

function luminance(rgb: Rgb): number {
  // Round through 8-bit sRGB, as the screen does, and clip out-of-gamut values.
  const [r, g, b] = rgb.map((channel) => toLinear(Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, channel))))) * 255) / 255)) as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(foreground: Rgb, background: Rgb): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

const SURFACES = ['bg', 'tone-1', 'tone-2', 'tone-3', 'surface', 'surface-2']

/** [foreground, backgrounds, minimum, what it is used for] */
const PAIRS: [string, string[], number, string][] = [
  ['text', [...SURFACES, 'gap'], TEXT, 'body text'],
  ['muted', SURFACES, TEXT, 'secondary text'],
  ['on-accent', ['accent'], TEXT, 'text on the yellow'],
  ['ok-fg', ['bg', 'surface', 'surface-2'], TEXT, 'status text'],
  ['warn-fg', ['bg', 'surface', 'surface-2'], TEXT, 'status text'],
  ['bad-fg', ['bg', 'surface', 'surface-2'], TEXT, 'status text'],
  ['sun-fg', ['bg', 'surface', 'surface-2'], TEXT, 'spec label text'],
  ['code-fg', ['bg', 'surface', 'surface-2'], TEXT, 'code label text'],
  ['code-text', ['code-bg', 'diff-add', 'diff-del', 'diff-add-word', 'diff-del-word'], TEXT, 'code'],
  ['border-strong', ['bg', 'surface'], GLYPH, 'input outline'],
  ['focus', ['bg', 'surface', 'tone-1'], GLYPH, 'focus ring'],
  ['mark', ['bg', 'surface', 'tone-1'], GLYPH, 'the hood'],
  ['code', ['surface'], GLYPH, 'code node color'],
  ['wire', ['surface'], GLYPH, 'wire at rest'],
  ['wire-active', ['surface'], GLYPH, 'active wire'],
]

let failures = 0
for (const [theme, selector] of [
  ['light', ':root,\n.light'],
  ['dark', '.dark'],
] as const) {
  const tokens = block(selector)
  console.log(`\n${theme}`)
  for (const [foreground, backgrounds, minimum, use] of PAIRS) {
    for (const background of backgrounds) {
      const value = ratio(resolve(lookup(`--hb-${foreground}`, tokens), tokens), resolve(lookup(`--hb-${background}`, tokens), tokens))
      const pass = value >= minimum
      if (!pass) failures += 1
      console.log(`  ${pass ? 'pass' : 'FAIL'}  ${value.toFixed(2).padStart(5)} (needs ${minimum})  ${foreground} on ${background}  [${use}]`)
    }
  }
}

console.log(failures ? `\n${failures} pair(s) fall short.` : '\nEvery pair passes.')
process.exit(failures ? 1 : 0)
