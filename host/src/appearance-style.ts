import { paletteProblems, readablePalette, type Palette } from '../../shared/protocol/appearance.ts'

export interface AppearanceStyle {
  palette: Palette
  border?: string
  borderStrong?: string
}

const TOKENS = [
  ['--hb-bg', 'background'], ['--hb-surface', 'surface'], ['--hb-text', 'text'],
  ['--hb-muted', 'muted'], ['--hb-accent', 'accent'],
] as const
const BORDER_TOKENS = [['--hb-border', 'border'], ['--hb-border-strong', 'borderStrong']] as const
const MAX_BYTES = 4096
const HEX = /^#[0-9a-f]{6}$/i
const SPACE = '[ \\t\\r\\n]*'
const BLOCK = new RegExp(`^${SPACE}:root${SPACE}\\{([^{}]*)\\}${SPACE}$`)
const DECLARATION = new RegExp(`${SPACE}(--[a-z-]+)${SPACE}:${SPACE}(#[0-9a-fA-F]{6})${SPACE};`, 'y')

/** This is a token artifact, never CSS to evaluate or inject. Throws on any unsupported syntax. */
export function decodeAppearanceStyle(input: unknown): AppearanceStyle {
  if (typeof input !== 'string' || input.length > MAX_BYTES || Buffer.byteLength(input, 'utf8') > MAX_BYTES) {
    throw new Error('Style must be a string of at most 4096 bytes.')
  }
  const body = BLOCK.exec(input)?.[1]
  if (body === undefined) throw new Error('Style must contain exactly one :root declaration block.')
  const values = new Map<string, string>()
  const allowed = new Set<string>([...TOKENS, ...BORDER_TOKENS].map(([token]) => token))
  let offset = 0
  // The sticky matcher must consume every declaration; trailing ASCII whitespace alone is allowed.
  const declaration = new RegExp(DECLARATION)
  while (offset < body.length && !/^[ \t\r\n]*$/.test(body.slice(offset))) {
    declaration.lastIndex = offset
    const match = declaration.exec(body)
    if (!match || !allowed.has(match[1]!) || values.has(match[1]!)) {
      throw new Error('Unsupported or duplicate style declaration.')
    }
    values.set(match[1]!, match[2]!.toLowerCase())
    offset = declaration.lastIndex
  }
  const candidate = Object.fromEntries(TOKENS.map(([token, key]) => [key, values.get(token)]))
  const palette = readablePalette(candidate)
  if (!palette) throw new Error(paletteProblems(candidate).join(' '))
  const result: AppearanceStyle = { palette }
  for (const [token, key] of BORDER_TOKENS) {
    const color = values.get(token)
    if (color !== undefined) result[key] = color
  }
  return result
}

/** Revalidates typed callers too; only known literal colors can enter the canonical artifact. */
export function encodeAppearanceStyle(value: AppearanceStyle): string {
  const palette = readablePalette(value.palette)
  if (!palette) throw new Error(paletteProblems(value.palette).join(' '))
  const declarations = TOKENS.map(([token, key]) => `  ${token}: ${palette[key]};`)
  for (const [token, key] of BORDER_TOKENS) {
    const color = value[key]
    if (color === undefined) continue
    if (typeof color !== 'string' || !HEX.test(color)) throw new Error('Border colors must be six-digit hex literals.')
    declarations.push(`  ${token}: ${color.toLowerCase()};`)
  }
  return `:root {\n${declarations.join('\n')}\n}\n`
}
