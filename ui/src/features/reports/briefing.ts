import { kindOf, sourceOf, toneOf, type Report, type Tone } from './report.ts'
import { dayKey, timeOf } from './time.ts'

/**
 * What the Reports home says before a report is open: what needs the user, what is new since they last looked, and
 * how the week's runs ended. Read only from the reports and hobkin's own read rollup (`reportAttention`). Pure, so
 * the rules can be tested without a window. Every list here is newest first, as the screen draws it.
 */

/** Most serious first. */
const SERIOUSNESS: readonly Tone[] = ['critical', 'blocked', 'useful', 'plain', 'nothing']
const rank = (tone: Tone) => SERIOUSNESS.indexOf(tone)

export interface SourceAttention {
  /** A routine's schedule, or the project work mode did it for. */
  key: string
  /** The routine's title, or the project's name. */
  label: string
  unread: number
  /** The most serious tone among its unread reports, and how many wear it. */
  worst: Tone
  worstCount: number
  /** The newest unread report of the worst tone. */
  openId: string
}

/** Unread reports by where they came from, most urgent first. A source whose unread reports say nothing new needs nothing. */
export function needsAttention(list: readonly Report[], read: ReadonlySet<string>): SourceAttention[] {
  const sources = new Map<string, SourceAttention>()
  for (const report of list) {
    if (read.has(report.id)) continue
    const tone = toneOf(report)
    const key = sourceOf(report)
    const source = sources.get(key)
    if (!source) {
      sources.set(key, { key, label: kindOf(report) === 'done' ? key : report.title, unread: 1, worst: tone, worstCount: 1, openId: report.id })
      continue
    }
    source.unread += 1
    if (rank(tone) < rank(source.worst)) Object.assign(source, { worst: tone, worstCount: 1, openId: report.id })
    else if (tone === source.worst) source.worstCount += 1
  }
  return [...sources.values()]
    .filter(({ worst }) => worst !== 'nothing')
    .sort((left, right) => rank(left.worst) - rank(right.worst) || right.worstCount - left.worstCount || right.unread - left.unread)
}

export interface Fresh {
  /** When the user last looked. */
  since: number
  /** Unread reports that came after it, the most serious tone among them, and the newest of that tone. */
  count: number
  worst: Tone | null
  openId: string | null
}

/**
 * What came since the user last looked: the latest read hobkin recorded for any routine, or the newest report the
 * user has read, whichever is later. Null when they have read nothing.
 */
export function sinceLastLook(list: readonly Report[], read: ReadonlySet<string>, attention: unknown): Fresh | null {
  const reads = (Array.isArray(attention) ? attention : []).map((row) => timeOf((row as { lastReadAt?: unknown } | null)?.lastReadAt as string))
  const seen = list.filter(({ id }) => read.has(id)).map((report) => timeOf(report.at))
  const since = Math.max(...[...reads, ...seen].filter((at): at is number => at !== null))
  if (!Number.isFinite(since)) return null
  const fresh: Fresh = { since, count: 0, worst: null, openId: null }
  for (const report of list) {
    if (read.has(report.id) || (timeOf(report.at) ?? -Infinity) <= since) continue
    const tone = toneOf(report)
    fresh.count += 1
    if (fresh.worst === null || rank(tone) < rank(fresh.worst)) Object.assign(fresh, { worst: tone, openId: report.id })
  }
  return fresh
}

export interface OutcomeDay {
  key: string
  /** The weekday, or Today. */
  label: string
  today: boolean
  completed: number
  failed: number
  /** Ended some other way: incomplete, interrupted, cancelled. */
  stopped: number
  /** The day's newest failed run, else its newest stopped one, else its newest. */
  openId: string | null
}

const DAYS = 7

/** How each of the last seven days' runs ended, oldest day first. */
export function outcomeWeek(list: readonly Report[], now: number): OutcomeDay[] {
  const days: OutcomeDay[] = []
  for (let back = DAYS - 1; back >= 0; back -= 1) {
    const day = new Date(now)
    day.setDate(day.getDate() - back)
    const label = back === 0 ? 'Today' : new Intl.DateTimeFormat('en', { weekday: 'short' }).format(day)
    days.push({ key: dayKey(day.getTime()), label, today: back === 0, completed: 0, failed: 0, stopped: 0, openId: null })
  }
  const byKey = new Map(days.map((day) => [day.key, day]))
  const worstOf = new Map<OutcomeDay, number>()
  for (const report of list) {
    const at = timeOf(report.at)
    const day = at === null ? undefined : byKey.get(dayKey(at))
    if (!day) continue
    const how = report.outcome === 'completed' ? 'completed' : report.outcome === 'failed' ? 'failed' : 'stopped'
    day[how] += 1
    const weight = { failed: 2, stopped: 1, completed: 0 }[how]
    if (weight > (worstOf.get(day) ?? -1)) {
      worstOf.set(day, weight)
      day.openId = report.id
    }
  }
  return days
}
