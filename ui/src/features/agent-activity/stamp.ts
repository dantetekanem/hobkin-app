import { clockSeconds, dayKey, timeOf } from '../reports/time.ts'

/**
 * When a row of an agent's work happened, as its page writes it beside the row: the time to the second in the
 * conversation's own clock, and the day too for a row from another day. The time is hobkin's, stamped where it first saw
 * the step (`at` on an activity entry) or written on a turn; the window never makes one up. Pure, so it is tested
 * without a window.
 */
export interface Stamp {
  /** "07:26:05 PM", or "19:26:05" where the clock is 24-hour. */
  time: string
  /** Only for a row from another calendar day: "Nov 14", with the year when it was not this one. */
  date: string | null
  /** For `<time dateTime>`. */
  iso: string
  /** The whole date and time, for a tooltip. */
  full: string
}

const day = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
const dayInYear = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })
const whole = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'medium' })

/** The stamp for a time, as hobkin writes one (milliseconds or ISO text), seen at `now`. Null when there is no time. */
export function stampOf(value: number | string | null | undefined, now: number): Stamp | null {
  const at = timeOf(value)
  if (at === null) return null
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear()
  return {
    time: clockSeconds(at),
    date: dayKey(at) === dayKey(now) ? null : (sameYear ? day : dayInYear).format(at),
    iso: new Date(at).toISOString(),
    full: whole.format(at),
  }
}

/**
 * Every shape a time of day takes in this clock: one morning and one evening time, which differ where the clock says
 * AM and PM. Drawn unseen in each row's stamp, so the column of times is as wide as the widest of them on every row.
 */
export const STAMP_SHAPES: readonly string[] = [...new Set([10, 22].map((hour) => clockSeconds(new Date(2000, 0, 1, hour, 0, 0).getTime())))]
