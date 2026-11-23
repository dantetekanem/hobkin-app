/**
 * The schedules an agent keeps for itself (`056-agent-schedules`): a command hobkin runs on a timer, or a plain timed
 * wake, that brings the agent back when there is something for it to do, such as a pull request's checks turning red.
 * The agent makes one with hobkin's `hobkin_schedule` tool, and the snapshot carries them all under `agentSchedules`.
 * They are not the user's routines (`010-routines`), which the snapshot has always called `schedules`. A host from
 * before sends none, and every field but `id` may be missing.
 */

/** Who made a schedule, and so who it wakes: the main chat, a durable hobkin by its id, or a run by its id. */
export interface AgentScheduleOwner {
  kind: 'main' | 'hobkin' | 'run'
  id?: string
}

/**
 * `waiting` for its next time, `running` its command now, `paused` by the user or the agent. The rest are ended:
 * `done` (it ran its runs or met what stops it), `cancelled`, `expired` (its lifetime passed) and `failed`.
 */
export type AgentScheduleState = 'waiting' | 'running' | 'paused' | 'done' | 'cancelled' | 'expired' | 'failed'

export const ENDED_SCHEDULE_STATES: readonly AgentScheduleState[] = ['done', 'cancelled', 'expired', 'failed']

/**
 * How a run of its command ended. `pending` is an exit code the agent named as "not yet", such as checks still
 * running: no wake, no stop and no failure. `error` is a command that could not start.
 */
export type AgentScheduleOutcome = 'passed' | 'failed' | 'pending' | 'timed-out' | 'error'

/** The newest run of a schedule. */
export interface AgentScheduleRun {
  /** When it ended, as an ISO time. */
  at: string
  outcome: AgentScheduleOutcome
  exitCode?: number
  /** Whether it woke the agent. */
  woke?: boolean
  /** The last line the command printed, cut short. */
  line?: string
}

export interface AgentSchedule {
  id: string
  owner?: AgentScheduleOwner
  /** The owner's name as the window shows it: "hobkin", a durable hobkin's name or a run's title. */
  ownerTitle?: string
  /** The agent's own name for it, such as "Watch CI for #412". */
  name?: string
  /** `shell` runs `command` each time; `wake` only wakes the agent. */
  does?: 'shell' | 'wake'
  command?: string
  /** What the agent told itself to do when woken. */
  note?: string
  /** Seconds between runs. Missing for a schedule that fires once. */
  every?: number
  state?: AgentScheduleState
  /** When it fires next, as an ISO time. Missing once it has ended or while it is paused. */
  nextAt?: string
  /** When its lifetime ends, as an ISO time. Every schedule has an end. */
  until?: string
  /** How many times it has run, and the most it may. */
  runs?: number
  maxRuns?: number
  /** How many times it has woken its agent, and the most it may. */
  wakes?: number
  maxWakes?: number
  last?: AgentScheduleRun
  /** For an ended schedule: why, in a few words, such as "the checks passed" or "its 2 hours ran out". */
  endedWhy?: string
}

/** What `schedule.cancel` and `schedule.run` take. Only the window sends them. */
export interface ScheduleTarget {
  id: string
}

/** What `schedule.pause` takes: `paused` true holds it, false lets it go on. */
export interface SchedulePause {
  id: string
  paused: boolean
}

/** The most rows the window gets: twenty live in the home at most, and the ones that ended lately. */
export const AGENT_SCHEDULES_MAX = 100

const STATES: readonly AgentScheduleState[] = ['waiting', 'running', 'paused', ...ENDED_SCHEDULE_STATES]
const OUTCOMES: readonly AgentScheduleOutcome[] = ['passed', 'failed', 'pending', 'timed-out', 'error']
const OWNERS: readonly AgentScheduleOwner['kind'][] = ['main', 'hobkin', 'run']
/** An id is kept whole or not at all, since a cut one would name another schedule or owner. */
const ID_MAX = 128
/** As long as the tools let an agent write each, and the rest short enough for a row. */
const WORDS_MAX = { name: 80, command: 4000, note: 1000, ownerTitle: 120, endedWhy: 200, line: 200 } as const

type Row = Record<string, unknown>

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const oneOf = <Word extends string>(words: readonly Word[], value: unknown): Word | undefined => (words.includes(value as Word) ? (value as Word) : undefined)
const idOf = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 && value.length <= ID_MAX ? value : undefined)
const countOf = (value: unknown): number | undefined => (Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : undefined)
const timeOf = (value: unknown): string | undefined => (typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value)) ? value : undefined)

/** Words no longer than `most`, cut before a character that would be split in two. */
function cut(value: unknown, most: number): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value.length <= most) return value
  const end = /[\uD800-\uDBFF]/.test(value[most - 1]!) ? most - 1 : most
  return value.slice(0, end)
}

/** Only the fields that have a value, so a missing one is missing rather than undefined. */
const present = <Shape extends object>(fields: { [Key in keyof Shape]: Shape[Key] | undefined }): Shape =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Shape

function ownerOf(value: unknown): AgentScheduleOwner | undefined {
  if (!isRow(value)) return undefined
  const kind = oneOf(OWNERS, value.kind)
  return kind && present<AgentScheduleOwner>({ kind, id: idOf(value.id) })
}

function lastOf(value: unknown): AgentScheduleRun | undefined {
  if (!isRow(value)) return undefined
  const at = timeOf(value.at)
  const outcome = oneOf(OUTCOMES, value.outcome)
  if (!at || !outcome) return undefined
  return present<AgentScheduleRun>({
    at,
    outcome,
    exitCode: Number.isSafeInteger(value.exitCode) ? (value.exitCode as number) : undefined,
    woke: typeof value.woke === 'boolean' ? value.woke : undefined,
    line: cut(value.line, WORDS_MAX.line),
  })
}

/** One row in the contract's shape, or nothing for a row with no id or a state the window cannot place. */
function scheduleOf(value: unknown): AgentSchedule | undefined {
  if (!isRow(value)) return undefined
  const id = idOf(value.id)
  const state = oneOf(STATES, value.state)
  if (!id || !state) return undefined
  const every = value.every
  return present<AgentSchedule>({
    id,
    owner: ownerOf(value.owner),
    ownerTitle: cut(value.ownerTitle, WORDS_MAX.ownerTitle),
    name: cut(value.name, WORDS_MAX.name),
    does: oneOf(['shell', 'wake'] as const, value.does),
    command: cut(value.command, WORDS_MAX.command),
    note: cut(value.note, WORDS_MAX.note),
    every: typeof every === 'number' && Number.isFinite(every) && every > 0 ? every : undefined,
    state,
    nextAt: timeOf(value.nextAt),
    until: timeOf(value.until),
    runs: countOf(value.runs),
    maxRuns: countOf(value.maxRuns),
    wakes: countOf(value.wakes),
    maxWakes: countOf(value.maxWakes),
    last: lastOf(value.last),
    endedWhy: cut(value.endedWhy, WORDS_MAX.endedWhy),
  })
}

/**
 * The runtime's `agentSchedules` read without trust: each row checked into the shape above, words cut short, a row the
 * window cannot place dropped, and an id given twice kept once. A runtime that has none reads as none.
 */
export function readAgentSchedules(value: unknown): AgentSchedule[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  const schedules: AgentSchedule[] = []
  for (const row of value) {
    if (schedules.length >= AGENT_SCHEDULES_MAX) break
    const schedule = scheduleOf(row)
    if (!schedule || seen.has(schedule.id)) continue
    seen.add(schedule.id)
    schedules.push(schedule)
  }
  return schedules
}
