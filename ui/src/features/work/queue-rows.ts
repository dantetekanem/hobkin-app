import type { QueueRow } from '#shared/protocol/work.ts'

/**
 * Which of hobkin's queue rows the Work page shows, and what it says after Start now. Pure, so it is tested without a
 * window. Spec: 011-work.
 */

/** How many rows a queue shows until the user asks for all of it, so what needs them below is a short scroll away. */
export const SHOWN_SHUT = 5

/**
 * The rows in sight: waiting ones in hobkin's order, then skipped ones. Shut, the first five show, and every P0 among
 * them even past five, so no P0 is out of sight. Open, all of them. `hidden` is how many the shut queue holds back.
 */
export function queueInSight(queue: readonly QueueRow[], open: boolean, most = SHOWN_SHUT): { rows: QueueRow[]; hidden: number } {
  const ordered = [...queue.filter(({ skipped }) => !skipped), ...queue.filter(({ skipped }) => skipped)]
  if (open) return { rows: ordered, hidden: 0 }
  const urgent = ordered.filter(({ grade, skipped }) => grade === 'P0' && !skipped)
  const others = ordered.filter((row) => !urgent.includes(row)).slice(0, Math.max(0, most - urgent.length))
  const rows = ordered.filter((row) => urgent.includes(row) || others.includes(row))
  return { rows, hidden: ordered.length - rows.length }
}

/**
 * The queue without the rows of paused projects: a paused project starts nothing, so its rows, skipped ones too, leave
 * the queue until it is switched back on. `paused` is how many went. With nothing paused it is the same list.
 */
export function outsidePaused(queue: readonly QueueRow[], pausedSlugs: ReadonlySet<string>): { rows: readonly QueueRow[]; paused: number } {
  if (!pausedSlugs.size) return { rows: queue, paused: 0 }
  const rows = queue.filter(({ slug }) => !slug || !pausedSlugs.has(slug))
  return { rows, paused: queue.length - rows.length }
}

interface Said {
  tone: 'done' | 'refused'
  text: string
}

/**
 * What the queue says after Start now on a row. The row may leave the queue as it starts, so the line is the queue's,
 * not the row's: hobkin's own words when it started or what still holds it, which name the row, or why it could not
 * start, with the row's title in front.
 */
export function startNowLine(title: string, said: Said): Said {
  if (said.tone === 'refused') return { tone: 'refused', text: `${title} did not start: ${said.text}` }
  return { tone: 'done', text: said.text || `${title}: asked to start at once.` }
}
