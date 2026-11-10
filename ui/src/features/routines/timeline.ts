/**
 * When routines run. Every time of a routine is a wall-clock time in the routine's own timezone, so every
 * answer here goes through that timezone's calendar. The rules are hobkin's (`src/cli/runner.mjs`):
 * a time the clocks skip is not run that day, a time the clocks repeat runs once (the first time), a month
 * without the day is skipped, a routine that is off has no times at all.
 *
 * Nothing here reads the clock or the page: the time is passed in, so it can be tested.
 */
import type { Hold, Routine } from './types.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
/** How far ahead a next run is looked for. Two months cover the longest gap between valid monthly dates. */
const FORECAST_DAYS = 62

export interface CalendarDate {
  year: number
  month: number
  day: number
}

export interface WallTime extends CalendarDate {
  hour: number
  minute: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterOf(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    formatters.set(timezone, formatter)
  }
  return formatter
}

/** The date and time a clock on the wall shows in a timezone at an instant. */
export function wallTime(timezone: string, instant: number): WallTime {
  const found = { year: 0, month: 0, day: 0, hour: 0, minute: 0 }
  for (const part of formatterOf(timezone).formatToParts(instant)) {
    if (part.type in found) found[part.type as keyof WallTime] = Number(part.value)
  }
  return found
}

const asUtc = (time: WallTime) => Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute)

const two = (value: number) => String(value).padStart(2, '0')

/** "2026-11-09". */
export const dateText = (date: CalendarDate) => `${date.year}-${two(date.month)}-${two(date.day)}`

export function addDays(date: CalendarDate, days: number): CalendarDate {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * DAY)
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() }
}

/**
 * The instant a wall-clock time happens in a timezone on a date, or null when that day has no such time
 * (the clocks skipped it). A time the clocks repeat gives its first instant.
 */
export function instantOf(timezone: string, date: CalendarDate, time: string): number | null {
  const wanted: WallTime = { ...date, hour: Number(time.slice(0, 2)), minute: Number(time.slice(3)) }
  const target = asUtc(wanted)
  const tried = new Set<number>()
  let first: number | null = null

  // The offset is read on both sides of any clock change near the date, then each candidate is checked exactly.
  for (let offset = -36; offset <= 36; offset += 6) {
    const probe = target + offset * HOUR
    const candidate = target - (asUtc(wallTime(timezone, probe)) - probe)
    if (tried.has(candidate)) continue
    tried.add(candidate)

    const showsWanted = asUtc(wallTime(timezone, candidate)) === target
    if (showsWanted && (first === null || candidate < first)) first = candidate
  }
  return first
}

/** The first instant of a date in a timezone. Midnight itself, unless the clocks skip it there. */
function startOfDay(timezone: string, date: CalendarDate): number {
  for (const time of ['00:00', '00:30', '01:00', '02:00']) {
    const instant = instantOf(timezone, date, time)
    if (instant !== null) return instant
  }
  return Date.UTC(date.year, date.month - 1, date.day)
}

/** The starts of `count` days from the day `now` is in, plus the end of the last one: `count + 1` instants. */
export function midnights(timezone: string, now: number, count: number): number[] {
  const today = wallTime(timezone, now)
  return Array.from({ length: count + 1 }, (_, index) => startOfDay(timezone, addDays(today, index)))
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
const timeOf = (minutes: number) => `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}`

/** The times of day a routine runs, in order: its one time, its list, or every step of its window. */
export function timesOfDay(routine: Pick<Routine, 'at' | 'window'>): string[] {
  const { window } = routine
  if (window) {
    const start = minutesOf(window.start)
    const every = Math.max(1, Math.floor(window.everyMinutes))
    const count = Math.max(0, Math.floor((minutesOf(window.end) - start) / every) + 1)
    return Array.from({ length: count }, (_, index) => timeOf(start + index * every))
  }
  if (routine.at === undefined) return []
  return [routine.at].flat().toSorted()
}

function runsOn(routine: Routine, date: CalendarDate): boolean {
  if (routine.cadence === 'daily') return true
  if (routine.cadence === 'once') return routine.date === dateText(date)
  if (routine.cadence === 'monthly') return routine.day === date.day
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()
  return [routine.weekday].flat().includes(weekday)
}

function parseDate(text: string | undefined): CalendarDate | null {
  const match = text?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null
}

/** One time a routine is due. */
export interface Occurrence {
  routineId: string
  at: number
  /** The date and the time in the routine's own timezone. */
  date: string
  time: string
  /** Which of the day's times this is, counted from 0. */
  index: number
}

/** The dates a walk looks at: a once routine's own date, or every day from the day `from` is in. */
function datesToWalk(routine: Routine, from: number, lastDay: number): CalendarDate[] {
  if (routine.cadence === 'once') {
    const date = parseDate(routine.date)
    return date ? [date] : []
  }
  const first = wallTime(routine.timezone, from)
  return Array.from({ length: lastDay + 1 }, (_, offset) => addDays(first, offset))
}

/** Every time the routine is due after `from`, in order, through `lastDay` days from that day. Ignores whether it is on. */
function* walk(routine: Routine, from: number, lastDay: number): Generator<Occurrence> {
  const times = timesOfDay(routine)

  for (const date of datesToWalk(routine, from, lastDay)) {
    if (!runsOn(routine, date)) continue
    for (const [index, time] of times.entries()) {
      const at = instantOf(routine.timezone, date, time)
      if (at !== null && at > from) yield { routineId: routine.id, at, date: dateText(date), time, index }
    }
  }
}

/** Every time a routine is due on one date of its own calendar, in order. Whether it is on, or runs that day, is not asked. */
export function occurrencesOn(routine: Routine, date: string): Occurrence[] {
  const day = parseDate(date)
  if (!day) return []
  return timesOfDay(routine).flatMap((time, index) => {
    const at = instantOf(routine.timezone, day, time)
    return at === null ? [] : [{ routineId: routine.id, at, date, time, index }]
  })
}

/** The next time the routine is due after `now`. Null when it is off, or when a once routine's time has passed. */
export function nextRun(routine: Routine, now: number): Occurrence | null {
  if (!routine.enabled) return null
  for (const occurrence of walk(routine, now, FORECAST_DAYS)) return occurrence
  return null
}

/** Every time the routine is due after `from` and up to `to`, in order. Nothing for a routine that is off. */
export function occurrencesBetween(routine: Routine, from: number, to: number): Occurrence[] {
  if (!routine.enabled || to <= from) return []
  // Two days more than the span, so a day that is longer or shorter than 24 hours never cuts the walk short.
  const days = Math.ceil((to - from) / DAY) + 2
  const found: Occurrence[] = []
  for (const occurrence of walk(routine, from, days)) {
    // Times come in order, so the first one past the end is the end of the walk.
    if (occurrence.at > to) break
    found.push(occurrence)
  }
  return found
}

/** A window's place in a line of the next seven days. */
export interface WindowEntry {
  /** The window's own first and last minute, as written in the routine. */
  start: string
  end: string
  everyMinutes: number
  /** The checks still to come that day. */
  checks: number[]
}

/** One line of the next seven days: a routine at a time, or a routine's window on a day. */
export interface TimelineEntry {
  /** Stays the same when the routine's time changes, so the line can be seen moving. */
  key: string
  routineId: string
  /** When it runs. For a window, its next check. */
  at: number
  /** The date and the time in the routine's own timezone. */
  date: string
  time: string
  window?: WindowEntry
}

export interface TimelineDay {
  /** "2026-11-09", where the user is. */
  date: string
  start: number
  end: number
  entries: TimelineEntry[]
}

/** The lines a routine adds between two times: one for each time it is due, or one a day for its window. */
export function entriesBetween(routine: Routine, from: number, to: number): TimelineEntry[] {
  const occurrences = occurrencesBetween(routine, from, to)
  const { window } = routine
  if (!window) {
    return occurrences.map(({ routineId, at, date, time, index }) => ({
      key: `${routineId}:${date}:${index}`,
      routineId,
      at,
      date,
      time,
    }))
  }

  const checksByDate = new Map<string, Occurrence[]>()
  for (const occurrence of occurrences) {
    const sameDay = checksByDate.get(occurrence.date) ?? []
    checksByDate.set(occurrence.date, [...sameDay, occurrence])
  }

  return [...checksByDate.values()].map((checks) => {
    const next = checks[0]!
    return {
      key: `${routine.id}:${next.date}:window`,
      routineId: routine.id,
      at: next.at,
      date: next.date,
      time: next.time,
      window: {
        start: window.start,
        end: window.end,
        everyMinutes: window.everyMinutes,
        checks: checks.map((check) => check.at),
      },
    }
  })
}

/** From when a routine can run again: now, or the end of its hold when that is later. */
export function clearOf(now: number, hold: Hold | null | undefined): number {
  const until = hold ? Date.parse(hold.until) : Number.NaN
  return Number.isFinite(until) ? Math.max(now, until) : now
}

/**
 * The next seven days where the user is: today and the six days after it, each with what runs on it, in time
 * order. A day with nothing is still a day. A held routine starts again after its hold.
 */
export function nextSevenDays(routines: readonly Routine[], now: number, viewZone: string, holds: Record<string, Hold | null | undefined> = {}): TimelineDay[] {
  const starts = midnights(viewZone, now, 7)
  const end = starts[7]!
  const today = wallTime(viewZone, now)
  const days: TimelineDay[] = Array.from({ length: 7 }, (_, index) => ({
    date: dateText(addDays(today, index)),
    start: starts[index]!,
    end: starts[index + 1]!,
    entries: [],
  }))

  for (const routine of routines) {
    for (const entry of entriesBetween(routine, clearOf(now, holds[routine.id]), end)) {
      days.findLast((day) => day.start <= entry.at)?.entries.push(entry)
    }
  }
  for (const day of days) day.entries.sort((first, second) => first.at - second.at)
  return days
}
