import type { AgentSchedule, AgentScheduleOutcome, AgentScheduleRunRecord, AgentScheduleRuns } from '#shared/protocol/schedules.ts'
import { agoWords, schedulesIn, type SchedulePlace } from './schedules.ts'

/**
 * Each run of an agent's schedules in that agent's conversation (`056-agent-schedules`): one quiet row at the moment it
 * ended, in order with the rest, that says what ran, how it ended, how long it took and whether it woke the agent.
 * Runs in a row that ended the same way fold into one row that counts them, so a check every two minutes for hours is
 * one row until something else happens. The runs are hobkin's (`schedule.runs`), so they are there after a reload.
 * Pure, so the rules are tested without a window.
 */

/** The schedule a run is of, as its row names it. */
export interface RunSchedule {
  id: string
  /** Its agent's name for it, or empty. */
  name: string
  does: 'shell' | 'wake'
  command?: string
}

/** One run with its schedule and when it ended, in milliseconds. */
export interface PlacedRun {
  schedule: RunSchedule
  run: AgentScheduleRunRecord
  at: number
}

/** A row of a conversation for runs: one, or several in a row that ended the same way, oldest first. */
export interface RunsRow {
  kind: 'schedule'
  /** Its first run's, so it keeps its key as later runs join it. */
  key: string
  schedule: RunSchedule
  runs: readonly [AgentScheduleRunRecord, ...AgentScheduleRunRecord[]]
  /** When its newest run ended, in milliseconds. */
  at: number
}

const timeOf = (iso: string | undefined): number | null => {
  const time = iso ? Date.parse(iso) : NaN
  return Number.isFinite(time) ? time : null
}

/** Every run of the schedules, each with its schedule, in the order they ended. */
export function placedRuns(list: readonly AgentScheduleRuns[]): PlacedRun[] {
  const placed: PlacedRun[] = []
  for (const schedule of list) {
    const shown: RunSchedule = {
      id: schedule.id,
      name: schedule.name ?? '',
      does: schedule.does ?? (schedule.command ? 'shell' : 'wake'),
      ...(schedule.command ? { command: schedule.command } : {}),
    }
    for (const run of schedule.runs) {
      const at = timeOf(run.at)
      if (at !== null) placed.push({ schedule: shown, run, at })
    }
  }
  return placed.sort((left, right) => left.at - right.at)
}

/** Runs fold together when they are of one schedule, ended the same way and woke their agent alike. */
const foldsWith = (row: RunsRow, next: PlacedRun) => {
  const last = row.runs.at(-1) ?? row.runs[0]
  return row.schedule.id === next.schedule.id && last.outcome === next.run.outcome && last.woke === next.run.woke
}

/**
 * The conversation's rows with the runs among them: each run goes before the first row that came after it ended, and
 * runs with nothing between them that ended the same way are one row. A row with no time of its own (`timeOf` null)
 * stays where it is, and one that is now (`Infinity`), such as the agent thinking, stays after every run. With no runs
 * the rows come back as they were.
 */
export function withRuns<Row>(rows: readonly Row[], runs: readonly PlacedRun[], timeOf: (row: Row) => number | null): readonly (Row | RunsRow)[] {
  if (!runs.length) return rows

  const shown: (Row | RunsRow)[] = []
  // The row of runs just placed, while nothing else has come after it.
  let folding: RunsRow | null = null
  const place = (placed: PlacedRun) => {
    if (folding && foldsWith(folding, placed)) {
      folding = { ...folding, runs: [...folding.runs, placed.run], at: placed.at }
      shown[shown.length - 1] = folding
      return
    }
    folding = {
      kind: 'schedule',
      key: `schedule:${placed.schedule.id}:${placed.run.at}`,
      schedule: placed.schedule,
      runs: [placed.run],
      at: placed.at,
    }
    shown.push(folding)
  }

  // The runs not placed yet start at `next`. `reached` is the latest time the rows so far have: a row with no time of
  // its own stands where the rows before it reached.
  let next = 0
  let reached = -Infinity
  for (const row of rows) {
    reached = Math.max(reached, timeOf(row) ?? reached)
    for (; next < runs.length; next++) {
      const placed = runs[next]
      if (placed === undefined || placed.at >= reached) break
      place(placed)
    }
    shown.push(row)
    folding = null
  }
  runs.slice(next).forEach(place)
  return shown
}

const firstLine = (text: string | undefined) => text?.split('\n').find((line) => line.trim())?.trim() ?? ''

/** The schedule's name, or the first line of what it runs. */
export const runName = (schedule: RunSchedule): string => schedule.name.trim() || firstLine(schedule.command) || 'A schedule'

/** What it runs, in short: its first line, with a mark when there are more. Null for a plain wake. */
function ranWords(schedule: RunSchedule): string | null {
  if (schedule.does === 'wake' || !schedule.command?.trim()) return null
  const lines = schedule.command.trim().split('\n')
  return lines.length > 1 ? `${firstLine(schedule.command)} …` : firstLine(schedule.command)
}

export type RunTone = 'ok' | 'bad' | 'quiet'

const TONE: Record<AgentScheduleOutcome, RunTone> = { passed: 'ok', failed: 'bad', pending: 'quiet', 'timed-out': 'bad', error: 'bad' }
const CUT_OFF = 'It was cut off before it finished.'

/** How a run ended, in a word or two: "ok", "exit 1", "pending", "timed out", "cut off", "could not start", or "woke it" for a plain wake. */
function endWords(schedule: RunSchedule, run: AgentScheduleRunRecord): string {
  if (schedule.does === 'wake') return run.woke === false ? 'did not wake it' : 'woke it'
  switch (run.outcome) {
    case 'passed':
      return 'ok'
    case 'failed':
      return run.exitCode === undefined ? 'failed' : `exit ${run.exitCode}`
    case 'pending':
      return 'pending'
    case 'timed-out':
      return 'timed out'
    case 'error':
      return run.line === CUT_OFF ? 'cut off' : 'could not start'
  }
}

/** Seconds as a step's time says them: 8s, 1m 05s. */
function took(run: AgentScheduleRunRecord): string | null {
  const started = timeOf(run.startedAt)
  const ended = timeOf(run.at)
  if (started === null || ended === null) return null
  const seconds = Math.max(0, Math.round((ended - started) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

export interface RunWords {
  name: string
  /** What it ran, in short. Null for a plain wake. */
  ran: string | null
  end: string
  tone: RunTone
  took: string | null
  /** "woke it" or "no wake". Null for a plain wake, whose end says it. */
  wake: string | null
}

/** What one run's row says. */
export function runWords(schedule: RunSchedule, run: AgentScheduleRunRecord): RunWords {
  const wakes = schedule.does === 'wake'
  return {
    name: runName(schedule),
    ran: ranWords(schedule),
    end: endWords(schedule, run),
    tone: wakes ? 'quiet' : TONE[run.outcome],
    took: took(run),
    wake: wakes ? null : run.woke ? 'woke it' : 'no wake',
  }
}

export interface FoldWords {
  name: string
  /** "ran 27 times". */
  count: string
  /** "all pending". */
  all: string
  /** "last 2 min ago". */
  last: string
  tone: RunTone
  /** "each woke it" or "no wake". Null for plain wakes. */
  wake: string | null
}

/** What a row of runs in a row says, at `now`. */
export function foldWords(row: RunsRow, now: number): FoldWords {
  const newest = runWords(row.schedule, row.runs.at(-1) ?? row.runs[0])
  // Runs fold by how they ended, so their exit codes may differ: they all failed.
  const all = row.runs.every((run) => endWords(row.schedule, run) === newest.end) ? newest.end : 'failed'
  return {
    name: newest.name,
    count: `ran ${row.runs.length} times`,
    all: `all ${all}`,
    last: `last ${agoWords(Math.max(0, now - row.at))}`,
    tone: newest.tone,
    wake: newest.wake === 'woke it' ? 'each woke it' : newest.wake,
  }
}

/**
 * What a page reads its runs again by: each of its own schedules with how many times it ran and when it last ended, from
 * the snapshot. It changes when one of them runs, and another agent's run changes nothing.
 */
export function runsKey(list: readonly AgentSchedule[], place: SchedulePlace): string {
  return JSON.stringify(schedulesIn(list, place).map((schedule) => [schedule.id, schedule.runs ?? null, schedule.last?.at ?? null, schedule.state ?? null]))
}
