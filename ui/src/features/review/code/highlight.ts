/**
 * Code highlighting, kept light: Shiki's core build with the JavaScript regex engine, so no WebAssembly
 * is loaded, two themes imported one by one, and each grammar loaded the first time its language is shown.
 *
 * One run over the code gives every token a color for the light theme and one for Dracula. The colors are
 * drawn as CSS variables, so changing the theme recolors code that is already on screen.
 *
 * Nothing here knows about a review. `highlightCode` can be used wherever code is shown.
 */
import { highlightWith } from './highlight-core.ts'
import { loadGrammar } from './languages.ts'
import type { Highlighted, HighlightedPart, TokenStyle } from './tokens.ts'

export { CODE_THEMES, loadedLanguages } from './highlight-core.ts'
export { languageOf } from './languages.ts'
export { FONT, tokenStyle, type Highlighted, type HighlightedPart, type TokenStyle } from './tokens.ts'

/** Highlights a long file a part at a time. `language` is a name from `languageOf`, or null for plain text. */
export async function* highlightInChunks(code: string, language: string | null, chunk = 400): AsyncGenerator<HighlightedPart> {
  yield* highlightWith(code, language, await loadGrammar(language), chunk)
}

/**
 * Highlights code for both themes in one pass.
 * `language` is a name from `languageOf`, or null for plain text.
 */
export async function highlightCode(code: string, language: string | null): Promise<Highlighted> {
  const lines: Highlighted['lines'] = []
  let styles: TokenStyle[] = []
  let passes = 0
  for await (const part of highlightInChunks(code, language, Number.MAX_SAFE_INTEGER)) {
    lines.push(...part.lines)
    styles = part.styles
    passes += 1
  }
  return { lines, styles, passes }
}
