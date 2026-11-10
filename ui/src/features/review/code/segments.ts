/**
 * Cuts a line into the runs it is drawn as: each run has one token style and is either a changed word or not.
 * Highlighting and word marks come from two different sources, so their boundaries rarely agree.
 */
import type { Highlighted } from './tokens.ts'
import type { WordRange } from './diff-rows.ts'

export interface Segment {
  text: string
  /** Index into the highlighted styles. Zero is plain text. */
  style: number
  /** Part of a word that changed within the line. */
  word: boolean
}

export function segmentsOf(text: string, tokens: Highlighted['lines'][number] | undefined, words: readonly WordRange[]): Segment[] {
  // Until the highlighter answers, or if its line is not this line, the text is drawn plain.
  const runs: [string, number][] = tokens && tokens.reduce((length, [part]) => length + part.length, 0) === text.length ? tokens : [[text, 0]]
  if (words.length === 0) return runs.map(([part, style]) => ({ text: part, style, word: false }))

  const segments: Segment[] = []
  let at = 0
  for (const [part, style] of runs) {
    const end = at + part.length
    let from = at
    while (from < end) {
      const inside = words.find((range) => range.start <= from && from < range.end)
      const next = inside ? Math.min(end, inside.end) : Math.min(end, ...words.filter((range) => range.start > from).map((range) => range.start))
      segments.push({ text: text.slice(from, next), style, word: inside != null })
      from = next
    }
    at = end
  }
  return segments
}
