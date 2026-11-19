import type { HighlightedPart } from '../review/code/tokens.ts'
import type { HighlightedText } from '../review/code/use-highlighted.ts'
import type { DiffItem } from '../review/code/diff-rows.ts'

/**
 * The colors of the code an agent's page has shown, kept while the window is open, so a page come back to is drawn in
 * its colors on its first paint instead of plain and then again in color. A code is kept by its text and its language.
 * The theme is not part of it: one result holds the colors of both themes (tokens.ts), and the page picks one.
 *
 * Without React or a window, so its rules are tested with a stand-in highlighter. `use-colors.ts` gives it to the page.
 */

/** Asks the highlighter for code's colors: parts arrive first lines first, then it is done. Returns a cancel. */
export type Ask = (code: string, language: string | null, listener: { part(part: HighlightedPart): void; done(): void }) => () => void

/**
 * How much code is kept, in characters: about ten thousand lines, enough for every change on the pages of the agents
 * shown lately. Past it, the code shown longest ago goes first.
 */
export const KEPT_CHARACTERS = 400_000

export interface Colors {
  /** The colors kept for this code in this language, or undefined. Reading them keeps them longer. */
  kept(code: string, language: string | null): HighlightedText | undefined
  /**
   * Colors code, telling `onColors` the lines colored so far as they arrive, and keeps them once every line has its
   * colors. Boxes showing the same code wait on one request. The function returned stops listening, and the last box to
   * stop cancels the request.
   */
  color(code: string, language: string | null, onColors: (colors: HighlightedText) => void): () => void
}

const keyOf = (code: string, language: string | null) => `${language ?? ''}\u0000${code}`

/** How many lines the highlighter answers for this code: a last empty line is not one. */
function lineCount(code: string): number {
  const lines = code.split(/\r\n|\r|\n/)
  return lines.at(-1) === '' ? lines.length - 1 : lines.length
}

/** One request to the highlighter, and the boxes waiting on it. */
interface Request {
  /** The lines colored so far, or null before the first part. */
  colors: HighlightedText | null
  boxes: Set<(colors: HighlightedText) => void>
  cancel: () => void
}

export function keptColors(ask: Ask, most = KEPT_CHARACTERS): Colors {
  // Oldest first: a Map keeps the order things were put in it.
  const kept = new Map<string, { colors: HighlightedText; size: number }>()
  let size = 0
  const pending = new Map<string, Request>()

  const keep = (key: string, code: string, colors: HighlightedText) => {
    if (code.length > most) return
    kept.set(key, { colors, size: code.length })
    size += code.length
    for (const [oldest, entry] of kept) {
      if (size <= most) break
      kept.delete(oldest)
      size -= entry.size
    }
  }

  const start = (key: string, code: string, language: string | null): Request => {
    const request: Request = { colors: null, boxes: new Set(), cancel: () => {} }
    pending.set(key, request)
    const lines: HighlightedText['lines'] = []
    let colored = 0
    const tell = (colors: HighlightedText) => {
      request.colors = colors
      for (const box of [...request.boxes]) box(colors)
    }
    request.cancel = ask(code, language, {
      part: (part) => {
        if (pending.get(key) !== request) return
        part.lines.forEach((line, index) => {
          if (lines[part.from + index] === undefined) colored += 1
          lines[part.from + index] = line
        })
        tell({ lines, styles: part.styles, done: false })
      },
      done: () => {
        if (pending.get(key) !== request) return
        pending.delete(key)
        const colors = { lines, styles: request.colors?.styles ?? [], done: true }
        // A request that failed on the way ends too: only one that colored every line is kept.
        if (colored === lineCount(code)) keep(key, code, colors)
        tell(colors)
      },
    })
    return request
  }

  return {
    kept(code, language) {
      const key = keyOf(code, language)
      const entry = kept.get(key)
      if (!entry) return undefined
      kept.delete(key)
      kept.set(key, entry)
      return entry.colors
    },
    color(code, language, onColors) {
      const key = keyOf(code, language)
      const known = kept.get(key)
      if (known) {
        onColors(known.colors)
        return () => {}
      }
      const request = pending.get(key) ?? start(key, code, language)
      request.boxes.add(onColors)
      // Lines that arrived before this box did, or while the request was being made.
      if (request.colors) onColors(request.colors)
      return () => {
        request.boxes.delete(onColors)
        if (request.boxes.size === 0 && pending.get(key) === request) {
          pending.delete(key)
          request.cancel()
        }
      }
    },
  }
}

/**
 * What a box of code is drawn in now: the colors kept for it, at once, wherever it is on the page. Until it has them it
 * is drawn plain, and it asks for them only once it is in or near view, so a page's entrance waits for none of it and
 * the boxes far from view cost nothing until they are scrolled to.
 */
export function colorsNow(colors: Pick<Colors, 'kept'>, code: string | null, language: string | null, near: boolean): { now: HighlightedText | null; asks: boolean } {
  if (code === null) return { now: null, asks: false }
  const now = colors.kept(code, language)
  return now ? { now, asks: false } : { now: null, asks: near }
}

/** Code is colored as far as its drawn lines reach, rounded up to this many lines, so a few more lines drawn ask for nothing new. */
export const COLORED_STEP = 100

/**
 * The part of code that is colored: its first lines, as far as `reach` (a line number) rounded up to a hundred lines, or
 * the whole code once that reaches its end. A big file whose first lines are drawn is colored for those lines only.
 */
export function coloredUpTo(code: string | null, reach: number): string | null {
  if (code === null) return null
  const upTo = Math.max(1, Math.ceil(reach / COLORED_STEP)) * COLORED_STEP
  let at = -1
  for (let line = 0; line < upTo; line += 1) {
    at = code.indexOf('\n', at + 1)
    if (at === -1) return code
  }
  return at === code.length - 1 ? code : code.slice(0, at)
}

/** The last line a drawn diff reaches on each side: the new side (`head`) for added and unchanged lines, the old (`base`) for removed ones. */
export function linesReached(items: readonly DiffItem[]): { head: number; base: number } {
  let head = 0
  let base = 0
  for (const item of items) {
    if (item.type !== 'line') continue
    const { kind, oldLine, newLine } = item.line
    if (kind === 'removed') base = Math.max(base, oldLine ?? 0)
    else head = Math.max(head, newLine ?? 0)
  }
  return { head, base }
}

/**
 * Colors that arrived, if they are for this code: for the same code, or for its first lines (which color those lines as
 * the whole code would), until the longer code's own arrive. Colors of other code are never drawn on it.
 */
export function colorsFitting(arrived: { code: string; language: string | null; colors: HighlightedText } | null, code: string, language: string | null): HighlightedText | null {
  if (!arrived || arrived.language !== language) return null
  return arrived.code === code || code.startsWith(`${arrived.code}\n`) ? arrived.colors : null
}
