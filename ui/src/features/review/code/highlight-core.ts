/**
 * The highlighter itself: Shiki's core build with the JavaScript regex engine, so no WebAssembly is loaded,
 * and the two themes imported one by one. It is given each grammar, and never fetches one itself, so the
 * worker that runs it stays one small file.
 */
import { createHighlighterCore, type HighlighterCore, type LanguageRegistration } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import dracula from 'shiki/themes/dracula.mjs'
import light from 'shiki/themes/github-light-high-contrast.mjs'
import { FONT, type Highlighted, type HighlightedPart, type TokenStyle } from './tokens.ts'

/** The light theme is the high-contrast one: its colors stay readable on the cream code surface. */
export const CODE_THEMES = { light: 'github-light-high-contrast', dark: 'dracula' } as const

const PLAIN: TokenStyle = { light: '', dark: '', lightFont: 0, darkFont: 0 }

let core: Promise<HighlighterCore> | undefined
const loaded = new Set<string>()

function highlighter(): Promise<HighlighterCore> {
  core ??= createHighlighterCore({ themes: [light, dracula], langs: [], engine: createJavaScriptRegexEngine() })
  return core
}

/** The languages the highlighter has been given so far. */
export function loadedLanguages(): string[] {
  return [...loaded]
}

function fontOf(style: Record<string, string>, theme: 'light' | 'dark'): number {
  return (
    (style[`--shiki-${theme}-font-style`] === 'italic' ? FONT.italic : 0) |
    (style[`--shiki-${theme}-font-weight`] === 'bold' ? FONT.bold : 0) |
    (style[`--shiki-${theme}-text-decoration`]?.includes('underline') ? FONT.underline : 0)
  )
}

/** Keeps each distinct style once. A file of thousands of tokens has a dozen or so. */
function styleTable() {
  const styles: TokenStyle[] = []
  const known = new Map<string, number>()
  return {
    styles,
    indexOf(html: Record<string, string> | undefined): number {
      const style: TokenStyle = html ? { light: html['--shiki-light'] ?? '', dark: html['--shiki-dark'] ?? '', lightFont: fontOf(html, 'light'), darkFont: fontOf(html, 'dark') } : PLAIN
      const key = `${style.light}|${style.dark}|${style.lightFont}|${style.darkFont}`
      let index = known.get(key)
      if (index == null) {
        index = styles.push(style) - 1
        known.set(key, index)
      }
      return index
    },
  }
}

function plainLines(code: string): string[] {
  const lines = code.split(/\r\n|\r|\n/)
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/**
 * Highlights code a part at a time with a grammar it is given, so the first lines of a long file can be drawn
 * before the rest is done. The grammar's state is carried from part to part, so a string or a comment that
 * runs across a boundary is colored as it would be in one run. With no grammar, the lines come back plain.
 */
export async function* highlightWith(code: string, language: string | null, grammar: LanguageRegistration[] | null, chunk = 400): AsyncGenerator<HighlightedPart> {
  const source = plainLines(code)
  const table = styleTable()
  if (!language || !grammar) {
    const plain = table.indexOf(undefined)
    yield { from: 0, lines: source.map((line) => [[line, plain]]), styles: table.styles }
    return
  }
  const shiki = await highlighter()
  if (!loaded.has(language)) {
    await shiki.loadLanguage(...grammar)
    loaded.add(language)
  }
  let grammarState: ReturnType<HighlighterCore['getLastGrammarState']> | undefined
  for (let from = 0; from < source.length; from += chunk) {
    const result = shiki.codeToTokens(source.slice(from, from + chunk).join('\n'), { lang: language, themes: CODE_THEMES, defaultColor: false, grammarState })
    grammarState = result.grammarState
    yield { from, lines: result.tokens.map((line) => line.map((token) => [token.content, table.indexOf(token.htmlStyle as Record<string, string> | undefined)])), styles: table.styles }
  }
}

export type { Highlighted }
