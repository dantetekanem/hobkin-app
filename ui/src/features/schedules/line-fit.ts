import type { ScheduleLineWords } from './schedules.ts'

/**
 * How much of the schedules line shows in the room it has (`056-agent-schedules`), and how much room it has in the main
 * chat's status row. As room shrinks it gives way in steps: the name and the countdown ("Watch CI in 1:42"), then the
 * count and the countdown ("3 · 1:42"), then the dot with the count ("3"), then the dot alone. A name is cut at a
 * whole word, and where no whole word fits the line takes the second step instead. Pure, with the text's width
 * measured by the caller, so the rule is tested without a window.
 *
 * The widths and gaps are the line's own, in pixels, as `ScheduleLine.tsx` draws it.
 */

/** The line's least and most room while the main chat's row is quiet, and its share of the row between them. */
const FULL_LEAST = 136
const FULL_MOST = 224
const FULL_SHARE = 0.4

/** The room of the count and the countdown with no name, of the dot with the count, and of the dot alone. */
export const COMPACT_WIDTH = 96
export const COUNT_WIDTH = 40
export const DOT_WIDTH = 28

/** Where the bubble starts, at the face's right, and the gap between the bubble, the working line and the line. */
const FACE = 96
const GAP = 8
/** The bubble's least room before the line gives way to it: about "writing…". */
const BUBBLE_LEAST = 72
/** The room the bubble leaves at its right on a row with no schedules (`SpeechBubble.tsx`): the face and 100px more. */
const PLAIN_RESERVE = 196

/** The pill around its words: its padding, the dot and the gap after it, and the arrow at its end with its gap. */
const PADDING = 16
const DOT_AND_GAP = 14
const ARROW_AND_GAP = 20
/** The gap between the count, the name and the countdown. */
const WORD_GAP = 4
/** Room from which the compact line still shows the arrow. */
const ARROW_FROM = 120

/** The main chat's line while the row is quiet: 40% of the row, between 8.5rem and 14rem. */
export function quietRoom(row: number): number {
  return Math.min(FULL_MOST, Math.max(FULL_LEAST, Math.round(row * FULL_SHARE)))
}

/** The status row while a turn runs, measured: what sits at its right and the bubble, each at its natural width. */
export interface TurnRow {
  row: number
  /** The working line (or the elapsed time) and "esc esc stops", with the gap between them. */
  natural: number
  /** The least of that: what cannot be cut, as the stop keys cannot. */
  least: number
  /** The bubble saying what the turn does. */
  bubble: number
  /** The working line gives way to the bubble, as a pulse does on a row with no schedules; the elapsed time does not. */
  givesWay: boolean
  /** How many schedules are live, for the dot with the count. */
  count: number
}

/**
 * Who keeps their room while a turn runs, in order. First the working line and "esc esc stops", with what they have
 * on a row with no schedules. Then the schedules line, in the widest of its forms that fits in what is left after
 * them and the bubble's least room. Then the bubble, with the rest. `line` is the line's width; `reserve` is what the
 * bubble leaves at its right, so it ends before the working line.
 */
export function turnRoom({ row, natural, least, bubble, givesWay, count }: TurnRow): { line: number; reserve: number } {
  const bubbleWithoutSchedules = Math.min(bubble, row - PLAIN_RESERVE)
  const kept = givesWay ? Math.max(least, Math.min(natural, row - FACE - GAP - bubbleWithoutSchedules)) : natural
  // The line's margin, the face, the gap before the working line and the working line itself.
  const forLineAndBubble = row - GAP - FACE - GAP - kept
  const forLine = forLineAndBubble - Math.min(bubble, BUBBLE_LEAST)
  return { line: widestForm(forLine, quietRoom(row), count), reserve: FACE + GAP + kept }
}

function widestForm(room: number, whole: number, count: number): number {
  if (room >= whole) return whole
  if (room >= COMPACT_WIDTH) return COMPACT_WIDTH
  if (room >= COUNT_WIDTH && count > 1) return COUNT_WIDTH
  return DOT_WIDTH
}

export type LineFit = { form: 'full'; name: string } | { form: 'compact'; arrow: boolean } | { form: 'count' } | { form: 'dot' }

/** Which of the line's forms its room holds, and the name as it is cut. */
export function lineFit(width: number, line: ScheduleLineWords, measure: (text: string) => number): LineFit {
  if (width < COMPACT_WIDTH) return width >= COUNT_WIDTH && line.count > 1 ? { form: 'count' } : { form: 'dot' }
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
  if (fit.form === 'count') return String(line.count)
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
