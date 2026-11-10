/**
 * Time as the lists say it. `now` is always passed in, so the words can be tested and a list can be drawn
 * for any moment. Days are the user's own calendar days.
 */

/** A time from hobkin, which writes ISO dates and sometimes milliseconds. Null when it is missing or unreadable. */
export function timeOf(value: string | number | null | undefined): number | null {
  const at = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Date.parse(value) : Number.NaN
  return Number.isFinite(at) ? at : null
}

const startOfDay = (at: number) => {
  const date = new Date(at)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Names the calendar day a time falls on. Two times on the same day share it. */
export function dayKey(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

/** Today, Yesterday, or the date. The year is said only when it is not this one. */
export function dayLabel(at: number, now: number): string {
  const today = new Date(now)
  if (startOfDay(at) === startOfDay(now)) return 'Today'
  if (startOfDay(at) === new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).getTime()) return 'Yesterday'
  const year = new Date(at).getFullYear() === today.getFullYear() ? {} : ({ year: 'numeric' } as const)
  return new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', ...year }).format(at)
}

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

/** The time of day, the way the conversation writes it. */
export function clockTime(at: number): string {
  return clock.format(at)
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

const count = (amount: number, unit: string) => `${amount} ${unit}${amount === 1 ? '' : 's'}`

/** How long something has waited, in the largest whole unit: "5 minutes", "3 hours", "2 days". */
export function waited(at: number, now: number): string {
  const span = Math.max(0, now - at)
  if (span < MINUTE_MS) return 'a moment'
  if (span < HOUR_MS) return count(Math.floor(span / MINUTE_MS), 'minute')
  if (span < DAY_MS) return count(Math.floor(span / HOUR_MS), 'hour')
  return count(Math.floor(span / DAY_MS), 'day')
}
