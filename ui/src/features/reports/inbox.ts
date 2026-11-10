import { kindOf, toneOf, type Report, type ReportKind, type Tone } from './report.ts'
import { dayKey, dayLabel, timeOf } from './time.ts'

/**
 * The reports the user holds: which are read, how the list is ordered, narrowed and grouped, and what a
 * delete and its undo do. Pure, so the rules can be tested without a window. Spec: 012-reports-actions.
 */

/** hobkin's three filters. */
export type KindFilter = 'all' | ReportKind

export interface ReportFilter {
  kind: KindFilter
  /** Narrows the list to titles that hold this text. */
  title: string
}

/** How long a deleted report can still be brought back. hobkin is told only once this has passed, because its delete cannot be undone. */
export const UNDO_MS = 8000

export interface Inbox {
  /** In the order hobkin gave them. */
  reports: readonly Report[]
  read: ReadonlySet<string>
  /** The report deleted last, where it was in the list, and until when its undo line shows. */
  removed: { report: Report; index: number; until: number } | null
}

export function createInbox(reports: readonly Report[], read: Iterable<string> = []): Inbox {
  return { reports, read: new Set(read), removed: null }
}

export function isUnread(inbox: Inbox, id: string): boolean {
  return !inbox.read.has(id)
}

/** Newest first, as hobkin lists them. Reports without a time come last, and equal times keep their order. */
export function newestFirst(reports: readonly Report[]): Report[] {
  return reports.toSorted((left, right) => (right.at ?? '').localeCompare(left.at ?? ''))
}

/** The reports of one kind whose title holds the text, whatever its case. */
export function filterReports(reports: readonly Report[], { kind, title }: ReportFilter): Report[] {
  const text = title.trim().toLowerCase()
  return reports.filter((report) => (kind === 'all' || kindOf(report) === kind) && report.title.toLowerCase().includes(text))
}

export interface DayGroup {
  key: string
  /** Today, Yesterday, or the date. */
  label: string
  reports: Report[]
}

/** Splits an ordered list where the day changes, keeping the order. */
export function byDay(reports: readonly Report[], now: number): DayGroup[] {
  const groups: DayGroup[] = []
  for (const report of reports) {
    const at = timeOf(report.at)
    const key = at === null ? 'undated' : dayKey(at)
    const last = groups.at(-1)
    if (last?.key === key) last.reports.push(report)
    else groups.push({ key, label: at === null ? 'Undated' : dayLabel(at, now), reports: [report] })
  }
  return groups
}

/** Opening a report is reading it. */
export function openReport(inbox: Inbox, id: string): Inbox {
  if (inbox.read.has(id) || !inbox.reports.some((report) => report.id === id)) return inbox
  return { ...inbox, read: new Set([...inbox.read, id]) }
}

/** Takes a report off the list and keeps it for `UNDO_MS`. An earlier delete that could still be undone is settled by this one. */
export function removeReport(inbox: Inbox, id: string, now: number): Inbox {
  const index = inbox.reports.findIndex((report) => report.id === id)
  if (index === -1) return inbox
  return { ...inbox, reports: inbox.reports.toSpliced(index, 1), removed: { report: inbox.reports[index]!, index, until: now + UNDO_MS } }
}

/** Puts the last deleted report back where it was. Whether it was read is kept all along. */
export function undoRemove(inbox: Inbox): Inbox {
  if (!inbox.removed) return inbox
  const { report, index } = inbox.removed
  return { ...inbox, reports: inbox.reports.toSpliced(Math.min(index, inbox.reports.length), 0, report), removed: null }
}

/** Lets the undo line go once its time has passed. From then on the delete stands. */
export function settle(inbox: Inbox, now: number): Inbox {
  return inbox.removed && now >= inbox.removed.until ? { ...inbox, removed: null } : inbox
}

export interface Summary {
  total: number
  unread: number
  /** Every report, counted by its tone. */
  tones: Record<Tone, number>
  /** The most serious tone among the unread, and how many unread reports wear it. */
  worst: Tone | null
  worstCount: number
}

/** Most serious first. */
const SERIOUSNESS: readonly Tone[] = ['critical', 'blocked', 'useful', 'plain', 'nothing']

export function summarize(reports: readonly Report[], read: ReadonlySet<string>): Summary {
  const tones: Record<Tone, number> = { critical: 0, blocked: 0, useful: 0, nothing: 0, plain: 0 }
  const unreadTones: Record<Tone, number> = { ...tones }
  let unread = 0
  for (const report of reports) {
    const tone = toneOf(report)
    tones[tone] += 1
    if (read.has(report.id)) continue
    unread += 1
    unreadTones[tone] += 1
  }
  const worst = SERIOUSNESS.find((tone) => unreadTones[tone] > 0) ?? null
  return { total: reports.length, unread, tones, worst, worstCount: worst ? unreadTones[worst] : 0 }
}

/** The report one place along the list, or null at either end. */
export function neighbor(list: readonly Report[], id: string, delta: 1 | -1): Report | null {
  const at = list.findIndex((report) => report.id === id)
  return at === -1 ? null : (list[at + delta] ?? null)
}

/** The report that takes a deleted one's place in the list: the one below it, or the one above when it was last. */
export function successor(list: readonly Report[], id: string): Report | null {
  return neighbor(list, id, 1) ?? neighbor(list, id, -1)
}
