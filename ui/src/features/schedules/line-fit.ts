import type { ScheduleLineWords } from './schedules.ts'

/**
 * How much of the schedules line shows in the room it has (`056-agent-schedules`). As room shrinks it gives way in
 * three steps: the name and the countdown ("Watch CI in 1:42"), then the count and the countdown ("3 · 1:42"), then
 * its dot alone. A name is cut at a whole word, and where no whole word fits the line takes the second step instead.
 * Pure, with the text's width measured by the caller, so the rule is tested without a window.
 *
 * The widths and gaps are the line's own, in pixels, as `ScheduleLine.tsx` draws it.
 */

/** The line's least and most room while the main chat's row is quiet, and its share of the row between them. */
const FULL_LEAST = 136
const FULL_MOST = 224
const FULL_SHARE = 0.4

/** The room of the count and the countdown with no name, and of the dot alone. */
export const COMPACT_WIDTH = 96
export const DOT_WIDTH = 28

/**
 * While a turn runs, the row keeps this much for the face, the bubble's first words, the working line and "esc esc
 * stops", and the line has what is left: its whole room in a wide chat, the compact one from a chat of about 460px,
 * the dot below that.
 */
const CROWDED_KEEPS = 328

/** The pill around its words: its padding, the dot and the gap after it, and the arrow at its end with its gap. */
const PADDING = 16
const DOT_AND_GAP = 14
const ARROW_AND_GAP = 20
/** The gap between the count, the name and the countdown. */
const WORD_GAP = 4
/** Room from which the compact line still shows the arrow. */
const ARROW_FROM = 120

/** The room the main chat's line takes while it has a schedule: whole while the row is quiet, less while a turn runs. */
export function lineRoom(row: number, crowded: boolean): number {
  const whole = Math.min(FULL_MOST, Math.max(FULL_LEAST, Math.round(row * FULL_SHARE)))
  if (!crowded) return whole
  const left = row - CROWDED_KEEPS
  if (left >= whole) return whole
  if (left >= COMPACT_WIDTH) return COMPACT_WIDTH
  return DOT_WIDTH
}

export type LineFit = { form: 'full'; name: string } | { form: 'compact'; arrow: boolean } | { form: 'dot' }

/** Which of the line's forms its room holds, and the name as it is cut. */
export function lineFit(width: number, line: ScheduleLineWords, measure: (text: string) => number): LineFit {
  if (width < COMPACT_WIDTH) return { form: 'dot' }
  // "2 paused" and "2 ended" have no name to show.
  const named = line.text !== line.short
  if (width >= FULL_LEAST && named) {
    const count = line.count > 1 ? measure(countWords(line)) + WORD_GAP : 0
    const room = width - PADDING - DOT_AND_GAP - ARROW_AND_GAP - count - WORD_GAP - measure(line.when)
    const name = wholeWords(line.name, room, measure)
    if (name) return { form: 'full', name }
  }
  return { form: 'compact', arrow: width >= ARROW_FROM }
}

/** The words the line shows in a form, as one string. */
export function shownWords(line: ScheduleLineWords, fit: LineFit): string {
  if (fit.form === 'dot') return ''
  if (fit.form === 'compact') return line.short
  const count = line.count > 1 ? `${countWords(line)} ` : ''
  return `${count}${fit.name} ${line.when}`
}

export const countWords = (line: ScheduleLineWords) => `${line.count} ·`

/** The name whole, or cut after its last whole word that fits with "…", or null when not even the first word does. */
function wholeWords(name: string, room: number, measure: (text: string) => number): string | null {
  if (measure(name) <= room) return name
  const words = name.split(/\s+/)
  for (let kept = words.length - 1; kept > 0; kept--) {
    const cut = `${words.slice(0, kept).join(' ')}…`
    if (measure(cut) <= room) return cut
  }
  return null
}
