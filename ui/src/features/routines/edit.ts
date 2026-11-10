/**
 * Checking a change to when a routine runs, before anything is written. The limits are hobkin's
 * (`scheduleTimes` in `src/cli/schedules.mjs`): a time is HH:mm in 24-hour time, a routine has 1 to 48
 * different times a day, and a window stays inside one day with a gap of 1 to 1440 whole minutes and at
 * most 48 checks. A value that breaks one is refused here, with a message that says what to change.
 */
import type { Routine, RoutineWindow } from './types.ts'

export type Checked<Value> = { ok: true; value: Value } | { ok: false; message: string }

/** A routine's new time, or its new list of times. */
export interface TimesEdit {
  at: string | string[]
}

export interface WindowEdit {
  window: RoutineWindow
}

const MOST_A_DAY = 48
const LONGEST_GAP = 1440

/** "9:30" and "09:30" both read as 09:30. Anything else is not a time of day. */
function readTime(text: string): string | null {
  const match = text.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null
  return `${match[1]!.padStart(2, '0')}:${match[2]}`
}

const refuse = (message: string) => ({ ok: false, message }) as const

/** What the user typed for a routine's time: one time, or several with commas or spaces between them. */
export function checkTimes(text: string): Checked<TimesEdit> {
  const typed = text.split(/[\s,]+/).filter(Boolean)
  if (typed.length === 0) return refuse('Write a time, like 09:30.')

  const times: string[] = []
  for (const one of typed) {
    const time = readTime(one)
    if (!time) return refuse(`"${one}" is not a time of day. Use 24-hour time from 00:00 to 23:59, like 09:30.`)
    if (times.includes(time)) return refuse(`${time} is listed twice. Each time can be listed once.`)
    times.push(time)
  }
  if (times.length > MOST_A_DAY) return refuse(`A routine can run at most ${MOST_A_DAY} times a day. This lists ${times.length}.`)

  // One time is written as one time, as hobkin's own files have it. Several are a list, in order.
  const at = times.length === 1 ? times[0]! : times.toSorted()
  return { ok: true, value: { at } }
}

/** What the user typed for a window: when it starts, when it ends, and the minutes between two checks. */
export function checkWindow(typed: { start: string; end: string; everyMinutes: string }): Checked<WindowEdit> {
  const start = readTime(typed.start)
  if (!start) return refuse(`The start, "${typed.start.trim()}", is not a time of day. Use 24-hour time, like 08:00.`)
  const end = readTime(typed.end)
  if (!end) return refuse(`The end, "${typed.end.trim()}", is not a time of day. Use 24-hour time, like 17:00.`)
  if (end < start) return refuse('The window ends before it starts. Both times are on the same day, so the end must be the later one.')

  const gap = typed.everyMinutes.trim()
  const everyMinutes = Number(gap)
  const wholeMinutes = /^\d+$/.test(gap)
  if (!wholeMinutes || everyMinutes < 1 || everyMinutes > LONGEST_GAP) {
    return refuse(`The gap must be a whole number of minutes, from 1 to ${LONGEST_GAP}.`)
  }

  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
  const checks = Math.floor((minutes(end) - minutes(start)) / everyMinutes) + 1
  if (checks > MOST_A_DAY) {
    return refuse(`That makes ${checks} checks a day, and a window can hold at most ${MOST_A_DAY}. Use a longer gap or a shorter window.`)
  }

  return { ok: true, value: { window: { start, end, everyMinutes } } }
}

/** What the time field shows for a routine as it is now. */
export function timesText(routine: Pick<Routine, 'at'>): string {
  return routine.at === undefined ? '' : [routine.at].flat().join(', ')
}
