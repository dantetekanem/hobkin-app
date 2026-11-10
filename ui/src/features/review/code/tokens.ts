/**
 * How a highlighted token is drawn. Kept apart from the highlighter, so drawing code never loads Shiki.
 */

/** Bits of a font style: italic, bold, underline. */
export const FONT = { italic: 1, bold: 2, underline: 4 } as const

export interface TokenStyle {
  /** The color in the light theme and in Dracula. Empty for plain text, which takes the surface's own color. */
  light: string
  dark: string
  lightFont: number
  darkFont: number
}

export interface Highlighted {
  /** Each line as pairs of text and an index into `styles`. */
  lines: [text: string, style: number][][]
  styles: TokenStyle[]
  /** How many runs over the code this took. One, whatever the number of themes. */
  passes: number
}

/** A part of a long file: `lines` start at line index `from`. `styles` is the whole table so far. */
export interface HighlightedPart {
  from: number
  lines: Highlighted['lines']
  styles: TokenStyle[]
}

/**
 * The inline style of a token: its two colors as CSS variables, and never a literal color.
 * The stylesheet picks `--tl` in the light theme and `--td` in the dark one.
 */
export function tokenStyle(style: TokenStyle): Record<string, string> {
  const variables: Record<string, string> = {}
  if (style.light) variables['--tl'] = style.light
  if (style.dark) variables['--td'] = style.dark
  if (style.lightFont) variables['--fl'] = String(style.lightFont)
  if (style.darkFont) variables['--fd'] = String(style.darkFont)
  return variables
}
