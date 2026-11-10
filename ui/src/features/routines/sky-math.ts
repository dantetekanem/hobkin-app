/**
 * The arithmetic behind the sky: the stretch of time it shows, where an instant sits along it, how high the
 * sun stands, and what gets a mark. Everything is a share of the span from 0 to 1, so the drawing can be any
 * width. Nothing here reads the clock or the page.
 */
import { clearOf, entriesBetween, midnights, occurrencesOn } from './timeline.ts'
import type { Hold, Routine, RunLine } from './types.ts'

/** A stretch of whole days where the user is, starting with today. */
export interface Span {
  start: number
  end: number
  /** The start of each day and the end of the last one. */
  days: number[]
}

export function spanOf(now: number, viewZone: string, dayCount: number): Span {
  const days = midnights(viewZone, now, dayCount)
  return { start: days[0]!, end: days.at(-1)!, days }
}

const HOUR = 3_600_000

/** A stretch that rolls with the clock: `before` hours behind now and `after` hours ahead, so now stays in one place. */
export function rollingSpan(now: number, viewZone: string, before: number, after: number): Span {
  const start = now - before * HOUR
  const end = now + after * HOUR
  // The midnights from the day the span starts in to the one after it ends, so every instant has its day for the sun.
  const days = midnights(viewZone, start, Math.ceil((end - start) / (24 * HOUR)) + 1)
  return { start, end, days }
}

/** Where an instant sits along the span: 0 at its start, 1 at its end. */
export function fractionAt(span: Span, instant: number): number {
  return (instant - span.start) / (span.end - span.start)
}

/**
 * How high the sun stands at an instant: 1 at noon, 0 at six in the morning and six in the evening,
 * -1 at midnight. Each day of the span has its own arc, however many hours the day has.
 */
export function sunHeight(span: Span, instant: number): number {
  // The day the instant falls in. An instant outside the span counts with the nearest day.
  const lastDay = span.days.length - 2
  const found = span.days.findLastIndex((start) => start <= instant)
  const day = Math.min(lastDay, Math.max(0, found))

  const start = span.days[day]!
  const end = span.days[day + 1]!
  const shareOfDay = (instant - start) / (end - start)
  return Math.sin(2 * Math.PI * (shareOfDay - 0.25))
}

interface MarkBase {
  /** Stays the same when the routine's time changes, so the mark can be seen moving. */
  key: string
  routineId: string
  /** Where it sits along the span, 0 to 1. */
  x: number
  at: number
}

/** A run that finished inside the span, set where it started. */
export interface RanMark extends MarkBase {
  kind: 'ran'
  status: string
  summary: string
  manual: boolean
}

/** A time a routine is still due at. `check` marks one step of a window. */
export interface DueMark extends MarkBase {
  kind: 'due'
  check: boolean
}

/** A window on one day, from its first minute to its last. */
export interface BandMark extends MarkBase {
  kind: 'band'
  end: number
}

export type SkyMark = RanMark | DueMark | BandMark

export interface SkyInput {
  span: Span
  now: number
  routines: readonly Routine[]
  logs: Record<string, readonly RunLine[] | undefined>
  holds: Record<string, Hold | null | undefined>
  /** Close up: what already ran in the span, and a mark for each check of a window. Further out, only what is still to come. */
  detail: boolean
}

/**
 * What the sky marks. Close up it shows what ran, each time still to come and each window with its checks.
 * Further out it shows only what is still to come, and a window as one band a day.
 */
export function skyMarks({ span, now, routines, logs, holds, detail }: SkyInput): SkyMark[] {
  const marks: SkyMark[] = []

  for (const routine of routines) {
    if (detail) marks.push(...ranMarks(routine, logs[routine.id] ?? [], span, now))

    const from = clearOf(now, holds[routine.id])
    if (routine.window) marks.push(...windowMarks(routine, from, span, detail))
    else marks.push(...dueMarks(routine, from, span))
  }

  return marks.sort((first, second) => first.at - second.at)
}

/** The runs that finished inside the span, each where it started. */
function ranMarks(routine: Routine, runs: readonly RunLine[], span: Span, now: number): RanMark[] {
  const marks: RanMark[] = []
  for (const run of runs) {
    const finished = Date.parse(run.finishedAt)
    const started = finished - run.seconds * 1000
    if (started < span.start || finished > now) continue

    marks.push({
      kind: 'ran',
      key: `${routine.id}:ran:${run.finishedAt}`,
      routineId: routine.id,
      x: fractionAt(span, started),
      at: started,
      status: run.status,
      summary: run.summary,
      manual: run.trigger === 'manual',
    })
  }
  return marks
}

/** Each time a routine is still due in the span. */
function dueMarks(routine: Routine, from: number, span: Span): DueMark[] {
  return entriesBetween(routine, from, span.end).map((entry) => ({
    kind: 'due',
    key: entry.key,
    routineId: routine.id,
    x: fractionAt(span, entry.at),
    at: entry.at,
    check: false,
  }))
}

/** A window is drawn whole on each day it is still running. Close up it also marks each check it has left. */
function windowMarks(routine: Routine, from: number, span: Span, detail: boolean): SkyMark[] {
  const marks: SkyMark[] = []
  for (const entry of entriesBetween(routine, from, span.end)) {
    const checks = occurrencesOn(routine, entry.date)
    const first = Math.max(checks[0]?.at ?? entry.at, span.start)
    const last = Math.min(checks.at(-1)?.at ?? entry.at, span.end)
    marks.push({
      kind: 'band',
      key: entry.key,
      routineId: routine.id,
      x: fractionAt(span, first),
      end: fractionAt(span, last),
      at: first,
    })
    if (!detail) continue

    for (const check of checks) {
      if (check.at <= from || check.at > span.end) continue
      marks.push({
        kind: 'due',
        key: `${routine.id}:${check.date}:${check.index}`,
        routineId: routine.id,
        x: fractionAt(span, check.at),
        at: check.at,
        check: true,
      })
    }
  }
  return marks
}
