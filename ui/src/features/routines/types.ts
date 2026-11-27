import type { RoutineTemplateRow } from '#shared/protocol/routine-templates.ts'

/**
 * Routines, shaped as hobkin's own data, so wiring the host later is an adapter and not a rewrite.
 * Source: hobkin `src/cli/schedules.mjs` (the files), `checks.mjs` (the log, the memory, the hold rule),
 * `routine-templates.mjs` (the templates). Spec: 010-routines.
 */

/** The folder a routine's file is in. It sets how often the routine runs. hobkin calls this `cadence`. */
export type Recurrence = 'daily' | 'weekly' | 'monthly' | 'once'

export const RECURRENCES: readonly Recurrence[] = ['daily', 'weekly', 'monthly', 'once']

/** Checks through part of a day: from `start`, every `everyMinutes`, none after `end`. */
export interface RoutineWindow {
  start: string
  end: string
  everyMinutes: number
}

/** One routine file, as hobkin's loader returns it: the JSON at the top, plus where it is and what it says. */
export interface Routine {
  id: string
  title: string
  /** "HH:mm", or 1 to 48 of them. A routine has `at` or `window`, never both. */
  at?: string | string[]
  window?: RoutineWindow
  /** IANA name. Every time of this routine is a wall-clock time here. */
  timezone: string
  enabled: boolean
  harness: 'pi'
  /** null uses Pi's own default model. */
  model: string | null
  effort: string
  cwd: string
  context: string[]
  /** Weekly routines: Sunday 0 to Saturday 6, one day or several. */
  weekday?: number | number[]
  /** Monthly routines: 1 to 31. A month without that day is skipped. */
  day?: number
  /** Once routines: "YYYY-MM-DD" in the routine's timezone. */
  date?: string

  cadence: Recurrence
  /** The host's authoritative next-run forecast, including holds and already-consumed slots. */
  nextRun?: { state: string; at: string | null; reason?: string }
  /** The file, as an absolute path. */
  path: string
  prompt: string
  /** The template it was made from, as `<id>@<version>`, when it names one (044-goal-first-setup). */
  template?: string
}

/** A file the loader could not use. The valid routines still load. */
export interface DefinitionError {
  path: string
  message: string
}

export type RunStatus = 'completed' | 'failed' | 'interrupted' | 'no_change' | 'incomplete'

/** One line of a routine's run log (`checks/<id>/log.md`): one finished run. */
export interface RunLine {
  /** ISO time the run finished. */
  finishedAt: string
  /** "scheduled" or "manual". */
  trigger: string
  /** One of hobkin's outcomes. A word this app does not know is kept as written. */
  status: RunStatus | (string & {})
  seconds: number
  /** Dollars, or null when the run reported no cost. */
  usd: number | null
  /** The first line of the run's report. */
  summary: string
}

/** A routine hobkin stopped starting for a while, after runs that got nowhere. */
export interface Hold {
  /** ISO time the wait ends. */
  until: string
  reason: string
}

/** A run that has started and not finished. */
export interface RunningRun {
  startedAt: number
  trigger: 'manual' | 'scheduled'
}

/** What the user sees a routine as. */
export type RoutineState = 'on' | 'off' | 'held' | 'running'

/** A ready-made routine hobkin can set up in a conversation, as the host lists them (`routine.templates`). */
export type RoutineTemplate = RoutineTemplateRow

/** Everything the screen draws, as the host will supply it. */
export interface RoutinesData {
  routines: Routine[]
  errors: DefinitionError[]
  /** Run log lines by routine id, oldest first, as in the file. */
  logs: Record<string, RunLine[]>
  /** Working memory by routine id: text the routine writes for itself. */
  memory: Record<string, string>
  /** The latest report by routine id, as Markdown. */
  reports: Record<string, string>
  running: Record<string, RunningRun>
  /** When a routine's schedule was last changed. Runs from before that no longer count toward a hold. */
  changedAt: Record<string, number>
  templates: RoutineTemplate[]
}
