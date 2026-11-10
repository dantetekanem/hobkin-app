/**
 * Routines in words: how often one runs, how long until it does, how a run went. Times are written in
 * 24-hour time, the way a routine's file has them. Nothing here reads the clock: the time is passed in.
 */
import { blockedMessage } from './holds.ts'
import type { RoutineFacts } from './rules.ts'
import { wallTime, type CalendarDate } from './timeline.ts'
import type { DefinitionError, Recurrence, Routine, RoutineState, RunLine } from './types.ts'

const MINUTE = 60_000
const DAY = 86_400_000

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const two = (value: number) => String(value).padStart(2, '0')
const dayNumber = (date: CalendarDate) => Date.UTC(date.year, date.month - 1, date.day) / DAY
const weekdayOf = (date: CalendarDate) => new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()

/** "a", "a and b", "a, b and c". */
function listText(items: string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

function ordinal(day: number): string {
  const tens = day % 100
  if (tens >= 11 && tens <= 13) return `${day}th`
  return `${day}${['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'}`
}

/** "every hour", "every 2 hours", "every 20 min". */
export function everyText(everyMinutes: number): string {
  if (everyMinutes === 60) return 'every hour'
  if (everyMinutes % 60 === 0) return `every ${everyMinutes / 60} hours`
  return `every ${everyMinutes} min`
}

/** A weekly routine's days, Sunday 0 to Saturday 6, each once and in week order. */
function weekdaysOf(weekday: Routine['weekday']): number[] {
  const listed = [weekday].flat().filter((day) => day !== undefined)
  return [...new Set(listed)].toSorted()
}

/** "Monday, Thursday", as the routine's file lists them. */
export function dayNames(weekday: Routine['weekday']): string {
  return weekdaysOf(weekday)
    .map((day) => WEEKDAYS[day])
    .join(', ')
}

/** "Every Monday and Thursday", or "Monday to Friday" for three days or more in a row. */
function weekdaysText(weekday: Routine['weekday']): string {
  const days = weekdaysOf(weekday)
  if (days.length === 7) return 'Every day'

  const first = days[0]!
  const inARow = days.length >= 3 && days.every((day, index) => day === first + index)
  if (inARow) return `${WEEKDAYS[first]} to ${WEEKDAYS[days.at(-1)!]}`

  return `Every ${listText(days.map((day) => WEEKDAYS[day]!))}`
}

/** "Nov 12, 2026" from "2026-11-12". */
function dateWords(date: string | undefined): string {
  const match = date?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}` : (date ?? '')
}

/** The times part alone: "at 09:00", "at 09:00 and 13:00", "from 08:00 to 17:00, every hour". */
function timesWords(routine: Pick<Routine, 'at' | 'window'>): string {
  const { window } = routine
  if (window) return `from ${window.start} to ${window.end}, ${everyText(window.everyMinutes)}`
  return `at ${listText([routine.at ?? []].flat().toSorted())}`
}

/** How often a routine runs, as a person would say it: "Monday to Friday at 08:15". */
export function howOften(routine: Routine): string {
  const times = timesWords(routine)
  if (routine.cadence === 'weekly') return `${weekdaysText(routine.weekday)} ${times}`
  if (routine.cadence === 'monthly') return `The ${ordinal(routine.day ?? 1)} of every month ${times}`
  if (routine.cadence === 'once') return `Once, on ${dateWords(routine.date)} ${times}`
  return `Every day ${times}`
}

export const RECURRENCE_TITLE: Record<Recurrence, string> = {
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
  once: 'Once',
}

export const STATE_WORD: Record<RoutineState, string> = {
  on: 'On',
  off: 'Off',
  held: 'Held',
  running: 'Running',
}

/** How long until a time: "in 42 min", "in 10 h 14 min", "in 3 days". */
export function untilText(at: number, now: number): string {
  const left = at - now
  if (left <= 0) return 'now'
  if (left < MINUTE) return 'in under a minute'
  const minutes = Math.floor(left / MINUTE)
  if (minutes < 60) return `in ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `in ${hours} h ${minutes % 60} min` : `in ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 2) return hours % 24 ? `in 1 day ${hours % 24} h` : 'in 1 day'
  return `in ${days} days`
}

/** How long a run took: "42 s", "3 min 5 s", "1 h 2 min". */
export function durationText(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  if (whole < 60) return `${whole} s`

  const minutes = Math.floor(whole / 60)
  const secondsLeft = whole % 60
  if (minutes < 60) return secondsLeft ? `${minutes} min ${secondsLeft} s` : `${minutes} min`

  const hours = Math.floor(minutes / 60)
  const minutesLeft = minutes % 60
  return minutesLeft ? `${hours} h ${minutesLeft} min` : `${hours} h`
}

/** A clock that counts up while a run goes on: "3:12". */
export function elapsedText(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}:${two(seconds % 60)}`
  return `${Math.floor(minutes / 60)}:${two(minutes % 60)}:${two(seconds % 60)}`
}

export function costText(usd: number | null): string {
  return usd === null ? 'not reported' : `$${usd.toFixed(2)}`
}

/** "09:00", in the timezone asked for. */
export function clockText(instant: number, timezone: string): string {
  const time = wallTime(timezone, instant)
  return `${two(time.hour)}:${two(time.minute)}`
}

/** How many calendar days from `now` to an instant, in a timezone: 0 today, 1 tomorrow, -1 yesterday. */
function daysAway(instant: number, timezone: string, now: number): number {
  return dayNumber(wallTime(timezone, instant)) - dayNumber(wallTime(timezone, now))
}

/** "Wed, Nov 11". */
export function dateLabel(instant: number, timezone: string): string {
  const date = wallTime(timezone, instant)
  return `${WEEKDAYS[weekdayOf(date)]!.slice(0, 3)}, ${MONTHS[date.month - 1]} ${date.day}`
}

/** A day by name: "Today", "Tomorrow", then the weekday. */
export function dayName(instant: number, timezone: string, now: number): string {
  const away = daysAway(instant, timezone, now)
  if (away === 0) return 'Today'
  if (away === 1) return 'Tomorrow'
  if (away === -1) return 'Yesterday'
  return WEEKDAYS[weekdayOf(wallTime(timezone, instant))]!
}

/** A day in a sentence: "today", "tomorrow", "Thursday" within the week ahead, and the date for anything further or behind. */
export function dayWord(instant: number, timezone: string, now: number): string {
  const away = daysAway(instant, timezone, now)
  if (away === 0) return 'today'
  if (away === 1) return 'tomorrow'
  if (away === -1) return 'yesterday'
  if (away > 1 && away < 7) return WEEKDAYS[weekdayOf(wallTime(timezone, instant))]!
  return dateLabel(instant, timezone)
}

/**
 * A day and a clock time in a timezone: "today 09:00", "tomorrow 09:00", "Thu 15:00" within the week ahead,
 * and the date itself for anything further or already behind: "Tue, Dec 1, 07:00".
 */
export function whenText(instant: number, timezone: string, now: number): string {
  const clock = clockText(instant, timezone)
  const away = daysAway(instant, timezone, now)
  if (away === 0) return `today ${clock}`
  if (away === 1) return `tomorrow ${clock}`
  if (away === -1) return `yesterday ${clock}`
  if (away > 1 && away < 7) return `${WEEKDAYS[weekdayOf(wallTime(timezone, instant))]!.slice(0, 3)} ${clock}`
  return `${dateLabel(instant, timezone)}, ${clock}`
}

const zoneNames = new Map<string, Intl.DateTimeFormat>()

/** A timezone by the name people use for it: "Portugal Time", "ET". Falls back to the name as written. */
export function zoneText(timezone: string, instant: number): string {
  try {
    let formatter = zoneNames.get(timezone)
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortGeneric' })
      zoneNames.set(timezone, formatter)
    }
    return formatter.formatToParts(instant).find((part) => part.type === 'timeZoneName')?.value ?? timezone
  } catch {
    return timezone
  }
}

/**
 * A routine's time, in its own timezone. When that is not the timezone the user is in, the zone is named
 * and the time here follows: "17:30 Portugal Time, 12:30 here".
 */
export function ownTime(instant: number, routineZone: string, viewZone: string): string {
  const own = clockText(instant, routineZone)
  if (routineZone === viewZone) return own
  return `${own} ${zoneText(routineZone, instant)}, ${clockText(instant, viewZone)} here`
}

/** The end of a hold up to the next whole minute, so a run due in that same minute is plainly before it or after it. */
export function holdEnds(until: string): number {
  return Math.ceil(Date.parse(until) / MINUTE) * MINUTE
}

/**
 * A moment in a sentence about a routine: "tomorrow at 09:00", or for a routine in another timezone,
 * "at 17:30 Portugal Time, tomorrow 12:30 here".
 */
function momentText(instant: number, routineZone: string, viewZone: string, now: number): string {
  if (routineZone === viewZone) return `${dayWord(instant, routineZone, now)} at ${clockText(instant, routineZone)}`
  const own = `${clockText(instant, routineZone)} ${zoneText(routineZone, instant)}`
  const here = `${dayWord(instant, viewZone, now)} ${clockText(instant, viewZone)}`
  return `at ${own}, ${here} here`
}

/** What a screen reader hears after a routine's name: its state, and when it runs next. */
export function stateSentence({ routine, state, hold, next, running }: RoutineFacts, now: number, viewZone: string): string {
  const moment = (instant: number) => momentText(instant, routine.timezone, viewZone, now)
  const nextRun = next ? `Next run ${moment(next.at)}, ${untilText(next.at, now)}.` : ''

  if (state === 'running' && running) return `Running for ${elapsedText(now - running.startedAt)}. ${nextRun}`
  if (state === 'off') return 'Off.'
  if (state === 'held' && hold) return `Held until ${moment(holdEnds(hold.until))}: ${hold.reason} ${nextRun}`
  return nextRun || 'Nothing left to run.'
}

/** How a run went, for a person. A report that says it is blocked reads as blocked, though the run finished. */
export type Tone = 'ok' | 'quiet' | 'warn' | 'bad'

export function outcomeOf(run: Pick<RunLine, 'status' | 'summary'>): { label: string; tone: Tone } {
  if (blockedMessage(run) !== null) return { label: 'Blocked', tone: 'warn' }
  switch (run.status) {
    case 'completed':
      return { label: 'Completed', tone: 'ok' }
    case 'no_change':
      return { label: 'Nothing new', tone: 'quiet' }
    case 'failed':
      return { label: 'Failed', tone: 'bad' }
    case 'incomplete':
      return { label: 'Stopped short', tone: 'bad' }
    case 'interrupted':
      return { label: 'Interrupted', tone: 'warn' }
    default:
      return { label: run.status.replaceAll('_', ' '), tone: 'quiet' }
  }
}

/** A routine file's path from the routines folder down. A path outside one is shown whole. */
export function routinePath(path: string): string {
  const folder = Math.max(path.lastIndexOf('/routines/'), path.lastIndexOf('/schedules/'))
  return folder === -1 ? path : path.slice(folder + 1)
}

/** Where a broken routine file is, from the routines folder down. */
export function errorFile(error: DefinitionError): string {
  return routinePath(error.path)
}

/** What is wrong with it. hobkin's loader starts some messages with the whole path, which the screen already shows. */
export function errorText(error: DefinitionError): string {
  const pathFirst = `${error.path}: `
  return error.message.startsWith(pathFirst) ? error.message.slice(pathFirst.length) : error.message
}
