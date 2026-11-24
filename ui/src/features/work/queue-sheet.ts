import type { QueueRow, WorkState } from '#shared/protocol/work.ts'
import { outsidePaused, queueInSight } from './queue-rows.ts'

/**
 * The queue sheet's rules: which rows it lists and in what order, how many the queue holds, when the sheet needs
 * reading again and which key opens it. Pure, so each is tested without a window.
 */

/**
 * Every row in hobkin's order, waiting ones first and skipped ones last. A project's choice keeps its rows only. The
 * rows of paused projects come after the rest, since they start nothing until the project is switched back on.
 */
export function sheetRows(queue: readonly QueueRow[], pausedSlugs: ReadonlySet<string>, only: string | null): { rows: QueueRow[]; paused: QueueRow[] } {
  const kept = only ? queue.filter(({ slug }) => slug === only) : queue
  const { rows: active } = outsidePaused(kept, pausedSlugs)
  const stopped = kept.filter((row) => !active.includes(row))
  return { rows: queueInSight(active, true).rows, paused: queueInSight(stopped, true).rows }
}

/**
 * How many rows the queue holds: every one that waits, paused projects' rows included, as hobkin counts them, which can
 * be more than the status lists, and the skipped rows it lists. Never fewer than the rows given.
 */
export function queueCount({ queue, queued }: Pick<WorkState, 'queue' | 'queued'>): number {
  const skipped = queue.filter((row) => row.skipped).length
  return Math.max(queued, queue.length - skipped) + skipped
}

/** Whether the queue on the page lists fewer rows than the queue holds. */
export const shownBefore = (shown: number, count: number): boolean => count > shown

/** What the queue's rows add up to, so the sheet reads the whole queue again only when it changed. */
export function queueSignature(queue: readonly QueueRow[], queued: number): string {
  return `${queued}|${queue.map(({ key, skipped, picked }) => `${key}${skipped ? '-' : ''}${picked ? '+' : ''}`).join(',')}`
}

interface KeyPress {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  repeat: boolean
  handled: boolean
  typing: boolean
}

/** A key that Q opens the queue with: Q alone, once, while no field is being typed in and nothing used the key. */
export function opensQueue(press: KeyPress): boolean {
  const plainQ = (press.key === 'q' || press.key === 'Q') && !press.metaKey && !press.ctrlKey && !press.altKey
  return plainQ && !press.repeat && !press.handled && !press.typing
}
