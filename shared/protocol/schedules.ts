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
