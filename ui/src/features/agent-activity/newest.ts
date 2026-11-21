import { useMemo, useState } from 'react'

/**
 * A long conversation draws only its newest steps: an agent's page and a durable hobkin's page draw the newest forty, and
 * a row above them says how many came before and draws forty more each time it is pressed. A step that is not drawn
 * works out no diff and adds nothing to the page. New steps still arrive at the bottom, and the newest stay drawn.
 */

/** How many of a conversation's newest steps are drawn when it opens, and how many more each press draws. */
export const NEWEST_STEPS = 40

/** The newest `drawn` of a conversation's steps, and how many came before them. A conversation that fits is the same list. */
export function newestOf<Item>(items: readonly Item[], drawn: number): { shown: readonly Item[]; earlier: number } {
  if (items.length <= drawn) return { shown: items, earlier: 0 }
  return { shown: items.slice(items.length - drawn), earlier: items.length - drawn }
}

/** How many are drawn after one more press: forty more, and never past the first step. */
export const drawMore = (drawn: number, total: number): number => Math.max(drawn, Math.min(total, drawn + NEWEST_STEPS))

/** How many are drawn once older steps read from the saved session come: forty of them, above the `drawn` there are. */
export const drawToCome = (drawn: number): number => drawn + NEWEST_STEPS

/** The row above the drawn steps: steps held and not drawn yet, or, with all of them drawn, older ones in the run's saved session. */
export type EarlierRow = { kind: 'held'; count: number } | { kind: 'saved'; loading: boolean }

/**
 * Which row shows above the drawn steps. Steps the window holds come first. Once all of them are drawn, a run whose feed
 * may have let older ones go (it is full, or the host said there are more) offers to read them, and says so while it
 * does. With none left, there is no row.
 */
export function earlierRow(earlier: number, saved: { more: boolean | null; loading: boolean; mayHaveOlder: boolean }): EarlierRow | null {
  if (earlier > 0) return { kind: 'held', count: earlier }
  if (saved.loading) return { kind: 'saved', loading: true }
  if (saved.more === true || (saved.more === null && saved.mayHaveOlder)) return { kind: 'saved', loading: false }
  return null
}

/** What the row says. */
export function earlierWords(row: EarlierRow): string {
  if (row.kind === 'saved') return row.loading ? 'Reading earlier steps…' : `Earlier steps · Show ${NEWEST_STEPS} more`
  const steps = row.count === 1 ? '1 earlier step' : `${row.count.toLocaleString('en-US')} earlier steps`
  const more = Math.min(row.count, NEWEST_STEPS)
  const show = more === row.count ? (row.count === 1 ? 'it' : 'them') : `${more} more`
  return `${steps} · Show ${show}`
}

/**
 * How many of a conversation's newest steps are drawn, kept for the conversation by its own name. Another
 * conversation starts again from forty.
 */
export function useNewest<Item>(name: string, items: readonly Item[]): { shown: readonly Item[]; earlier: number; more: () => void; toCome: () => void } {
  const [drawn, setDrawn] = useState({ name, count: NEWEST_STEPS })
  const count = drawn.name === name ? drawn.count : NEWEST_STEPS
  // The same steps give the same list, so what follows the list's changes runs only when it changed.
  const { shown, earlier } = useMemo(() => newestOf(items, count), [items, count])
  return {
    shown,
    earlier,
    more: () => setDrawn({ name, count: drawMore(count, items.length) }),
    // Older steps on their way from the saved session: forty of them are drawn once they come.
    toCome: () => setDrawn({ name, count: drawToCome(Math.min(count, items.length)) }),
  }
}

/**
 * The rows with the row that reads older steps put where those steps go: before the first row `of` the run they belong
 * to, as on a hobkin's page, where they come after the live turn's message. With no such row, the rows as they are.
 */
export function withEarlier<Row>(rows: readonly Row[], of: (row: Row) => boolean, earlier: Row): readonly Row[] {
  const at = rows.findIndex(of)
  return at < 0 ? rows : [...rows.slice(0, at), earlier, ...rows.slice(at)]
}
