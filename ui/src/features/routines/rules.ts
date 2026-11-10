/**
 * What changes when the user acts on a routine, as plain functions from the data before to the data after.
 * Mutations are sample-only. Host data and its next-run forecast remain authoritative.
 */
import type { TimesEdit, WindowEdit } from './edit.ts'
import { holdOf } from './holds.ts'
import { clearOf, nextRun, type Occurrence } from './timeline.ts'
import type { Hold, Routine, RoutineState, RoutinesData, RunLine, RunningRun, RunStatus } from './types.ts'

/** How many runs a routine's detail shows. */
export const RUNS_SHOWN = 20

/** What a routine shows as. A run in progress comes first: a routine that is off or held can still be run by hand. */
export function stateOf(routine: Routine, running: boolean, hold: Hold | null): RoutineState {
  if (running) return 'running'
  if (!routine.enabled) return 'off'
  return hold ? 'held' : 'on'
}

/** The hold on a routine now, from its run log. Runs from before its schedule last changed do not count. */
export function holdFor(data: RoutinesData, id: string, now: number): Hold | null {
  const forecast = data.routines.find((routine) => routine.id === id)?.nextRun
  if (forecast) {
    return forecast.state === 'held' && forecast.at
      ? { until: forecast.at, reason: forecast.reason ?? 'Held by hobkin' }
      : null
  }
  return holdOf(data.logs[id] ?? [], now, data.changedAt[id])
}

/** What the screen says about one routine at a moment. */
export interface RoutineFacts {
  routine: Routine
  state: RoutineState
  hold: Hold | null
  /** The next time it runs by itself. A held routine's comes after its hold. Null when it is off or has nothing left. */
  next: Pick<Occurrence, 'at'> | null
  running: RunningRun | undefined
  lastRun: RunLine | undefined
}

export function factsOf(data: RoutinesData, now: number): RoutineFacts[] {
  return data.routines.map((routine) => {
    const hold = holdFor(data, routine.id, now)
    const running = data.running[routine.id]
    return {
      routine,
      state: stateOf(routine, running !== undefined || routine.nextRun?.state === 'running', hold),
      hold,
      next: routine.nextRun
        ? (routine.nextRun.at ? { at: Date.parse(routine.nextRun.at) } : null)
        : nextRun(routine, clearOf(now, hold)),
      running,
      lastRun: data.logs[routine.id]?.at(-1),
    }
  })
}

/** Soonest first. A routine with no next run, such as one that is off, goes last. Ties go by title. */
export function byNextRun(first: RoutineFacts, second: RoutineFacts): number {
  const at = (facts: RoutineFacts) => facts.next?.at ?? Number.POSITIVE_INFINITY
  return at(first) - at(second) || first.routine.title.localeCompare(second.routine.title)
}

/** The newest runs first, as the detail lists them. */
export function latestRuns(lines: readonly RunLine[], count = RUNS_SHOWN): RunLine[] {
  return lines.slice(-count).toReversed()
}

/** Run now. A routine that is already running is not started twice. */
export function startRun(data: RoutinesData, id: string, now: number, trigger: 'manual' | 'scheduled' = 'manual'): RoutinesData {
  if (id in data.running) return data
  if (!data.routines.some((routine) => routine.id === id)) return data

  return {
    ...data,
    running: { ...data.running, [id]: { startedAt: now, trigger } },
  }
}

export interface RunOutcome {
  status: RunStatus
  usd: number | null
  /** The first line of the run's report. */
  summary: string
  /** The whole report, when the run brought one. */
  report?: string
}

/** A run ends: it leaves the running ones and joins the routine's log as one line. */
export function finishRun(data: RoutinesData, id: string, now: number, outcome: RunOutcome): RoutinesData {
  const run = data.running[id]
  if (!run) return data
  const { [id]: _finished, ...running } = data.running
  const line: RunLine = {
    finishedAt: new Date(now).toISOString(),
    trigger: run.trigger,
    status: outcome.status,
    seconds: Math.round((now - run.startedAt) / 1000),
    usd: outcome.usd,
    summary: outcome.summary,
  }
  return {
    ...data,
    running,
    logs: { ...data.logs, [id]: [...(data.logs[id] ?? []), line] },
    reports: outcome.report === undefined ? data.reports : { ...data.reports, [id]: outcome.report },
  }
}

/** The data with one routine replaced by its changed copy. The others keep their identity. */
function change(data: RoutinesData, id: string, next: (routine: Routine) => Routine): RoutinesData {
  return {
    ...data,
    routines: data.routines.map((routine) => (routine.id === id ? next(routine) : routine)),
  }
}

/** Turns a routine on or off. */
export function setEnabled(data: RoutinesData, id: string, enabled: boolean): RoutinesData {
  const routine = data.routines.find((item) => item.id === id)
  if (!routine || routine.enabled === enabled) return data

  return change(data, id, (current) => ({ ...current, enabled }))
}

/** Gives a routine a new time, list of times or window. A routine has a time or a window, never both. */
export function changeTimes(data: RoutinesData, id: string, edit: TimesEdit | WindowEdit, now: number): RoutinesData {
  if (!data.routines.some((routine) => routine.id === id)) return data

  const changed = change(data, id, ({ at: _at, window: _window, ...rest }) => ({ ...rest, ...edit }))
  // A changed schedule is a fresh start: the runs before it no longer hold the routine.
  return {
    ...changed,
    changedAt: { ...data.changedAt, [id]: now },
  }
}
