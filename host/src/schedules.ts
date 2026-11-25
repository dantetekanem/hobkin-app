import { ENDED_SCHEDULE_STATES, readAgentSchedules, readScheduleRuns, type AgentSchedule, type ScheduleRunsOf } from '#shared/protocol/schedules.ts'
import { Unavailable, type HostHandlers } from './commands.ts'

/**
 * The schedules agents keep for themselves (056-agent-schedules), on their way from hobkin's runtime to the window and
 * the window's three commands back. hobkin's runtime keeps and fires them; the host reads its list without trust,
 * names each owner as the window shows it, and passes on the user's Cancel, Pause and Run now.
 */

/** The runtime's three operations on one schedule, by its id. Each answers `{ ok: true }` or `{ ok: false, reason }`, read without trust. */
export interface ScheduleOperations {
  cancel(id: string): Promise<unknown> | unknown
  pause(id: string, paused: boolean): Promise<unknown> | unknown
  run(id: string): Promise<unknown> | unknown
}

/** The three methods as hobkin's running application has them. A runtime from before has none. */
interface ScheduleMethods {
  cancelAgentSchedule?: unknown
  pauseAgentSchedule?: unknown
  runAgentSchedule?: unknown
}

type Method = (...args: unknown[]) => unknown

const isMethod = (value: unknown): value is Method => typeof value === 'function'

/** The application's own schedule methods as the handlers call them, or nothing when it lacks any of the three. */
export function scheduleOperationsOf(app: object): ScheduleOperations | null {
  const { cancelAgentSchedule: cancel, pauseAgentSchedule: pause, runAgentSchedule: run } = app as ScheduleMethods
  if (!isMethod(cancel) || !isMethod(pause) || !isMethod(run)) return null

  return {
    cancel: (id) => cancel.call(app, id),
    pause: (id, paused) => pause.call(app, id, paused),
    run: (id) => run.call(app, id),
  }
}

/** How one agent's schedules and their runs are read from the application, by its own method. */
export type ScheduleRunsReader = (owner: ScheduleRunsOf) => unknown

/** The application's own reader of an agent's schedule runs, or nothing from a runtime that keeps none. */
export function scheduleRunsOf(app: object | null | undefined): ScheduleRunsReader | null {
  const runs = (app as { agentScheduleRuns?: unknown } | null | undefined)?.agentScheduleRuns
  if (!isMethod(runs)) return null
  return (owner) => runs.call(app, owner)
}

/**
 * What the application gives a run on Claude Code for `hobkin schedule`: its token and home, or null for a run that
 * keeps no schedules and from a runtime without them. The route checks what comes back.
 */
export async function scheduleEnvironmentOf(app: object | null | undefined, harnessId: string, options: { commands: boolean }): Promise<unknown> {
  const environment = (app as { agentScheduleEnvironment?: unknown } | null | undefined)?.agentScheduleEnvironment
  if (!isMethod(environment)) return null
  return environment.call(app, harnessId, options)
}

export interface ScheduleSeat {
  /** The runtime's operations, or nothing from a runtime that has none. Throws `Unavailable` while hobkin is not open. */
  operations: () => ScheduleOperations | null | undefined
  /** The schedules as the window has them now, or nothing from a runtime that sends none. */
  schedules: () => readonly AgentSchedule[] | undefined
  /** The runtime's reader of an agent's schedule runs, or nothing from one that keeps none. Throws `Unavailable` while hobkin is not open. */
  runs?: () => ScheduleRunsReader | null | undefined
}

const NOT_AVAILABLE = 'Schedules are not available in this hobkin yet. Restart the app to load them.'
const UNKNOWN = 'hobkin has no such schedule, so nothing changed.'
const NO_ANSWER = 'hobkin did not say it was done, so the schedule may be as it was.'
/** As long as a refusal the window shows may be. */
const REASON_MAX = 300
/** As long as the contract's reader lets an owner's name be. */
const OWNER_TITLE_MAX = 120

const isEnded = (schedule: AgentSchedule): boolean => schedule.state !== undefined && ENDED_SCHEDULE_STATES.includes(schedule.state)

/** Why an ended schedule cannot take the command, naming it and how it ended when the runtime said. */
function endedWords(schedule: AgentSchedule, outcome: string): string {
  const which = schedule.name ? `"${schedule.name}"` : 'That schedule'
  const why = schedule.endedWhy ? ` (${schedule.endedWhy})` : ''
  return `${which} has already ended${why}, so ${outcome}.`
}

/** The runtime's answer as the command's: done, or its own words as the refusal. */
function answered(answer: unknown): { ok: true } {
  const { ok, reason } = (answer ?? {}) as { ok?: unknown; reason?: unknown }
  if (ok === true) return { ok: true }

  const saidWhy = ok === false && typeof reason === 'string' && reason.trim() !== ''
  throw new Unavailable(saidWhy ? reason.slice(0, REASON_MAX) : NO_ANSWER)
}

type ScheduleCommand = 'schedule.cancel' | 'schedule.pause' | 'schedule.run' | 'schedule.runs'

export function scheduleHandlers({ operations, schedules, runs }: ScheduleSeat): Pick<HostHandlers, ScheduleCommand> {
  /** The runtime's operations. hobkin not open says so; a runtime without them, or one that breaks reaching them, has none. */
  const available = (): ScheduleOperations => {
    let found: ScheduleOperations | null | undefined
    try {
      found = operations()
    } catch (error) {
      if (error instanceof Unavailable) throw error
      found = null
    }
    if (!found) throw new Unavailable(NOT_AVAILABLE)
    return found
  }

  /** Asks the runtime for a live schedule it has; an unknown or ended one is refused without asking. */
  const act = async (id: string, outcome: string, call: (runtime: ScheduleOperations) => unknown) => {
    const runtime = available()
    const schedule = schedules()?.find((each) => each.id === id)
    if (!schedule) throw new Unavailable(UNKNOWN)
    if (isEnded(schedule)) throw new Unavailable(endedWords(schedule, outcome))
    return answered(await call(runtime))
  }

  return {
    'schedule.cancel': ({ id }) => act(id, 'there is nothing to cancel', (runtime) => runtime.cancel(id)),
    'schedule.pause': ({ id, paused }) => act(id, paused ? 'it cannot be paused' : 'it cannot go on', (runtime) => runtime.pause(id, paused)),
    'schedule.run': ({ id }) => act(id, 'it cannot run now', (runtime) => runtime.run(id)),
    // A runtime that keeps no runs has none to show, so its pages show none.
    'schedule.runs': async ({ kind, id }) => {
      const read = runs?.()
      if (!read) return { schedules: [] }
      const answer: unknown = await read(id === undefined ? { kind } : { kind, id })
      const schedules = typeof answer === 'object' && answer !== null && 'schedules' in answer ? answer.schedules : undefined
      return { schedules: readScheduleRuns(schedules) }
    },
  }
}

interface Named {
  id?: unknown
  title?: unknown
}

/** An owner's name as the window shows it: "hobkin" for the main chat, a durable hobkin's name, a run's title. */
function ownerTitleOf(schedule: AgentSchedule, runs: unknown, hobkins: unknown): string | undefined {
  const owner = schedule.owner
  if (!owner) return undefined
  if (owner.kind === 'main') return 'hobkin'

  const rows = owner.kind === 'hobkin' ? hobkins : runs
  if (!Array.isArray(rows) || !owner.id) return undefined

  const title = (rows as Named[]).find((row) => row?.id === owner.id)?.title
  if (typeof title !== 'string' || !title.trim()) return undefined
  return title.slice(0, OWNER_TITLE_MAX)
}

/** The rows with an owner's name where the runtime gave none. */
function withOwnerTitles(list: AgentSchedule[], runs: unknown, hobkins: unknown): AgentSchedule[] {
  return list.map((schedule) => {
    if (schedule.ownerTitle !== undefined) return schedule
    const ownerTitle = ownerTitleOf(schedule, runs, hobkins)
    return ownerTitle ? { ...schedule, ownerTitle } : schedule
  })
}

/** Every key of a snapshot but its schedules, without reading them. */
function withoutSchedules<Snapshot extends object>(snapshot: Snapshot): Snapshot {
  const fields = snapshot as Record<string, unknown>
  const kept = Object.keys(fields).filter((key) => key !== 'agentSchedules')
  return Object.fromEntries(kept.map((key) => [key, fields[key]])) as Snapshot
}

/**
 * The snapshot's `agentSchedules` as the window gets them. The same schedules, runs and hobkins give the same list, so
 * the window is not sent it again.
 */
export class AgentScheduleReader {
  private made: { from: unknown; runs: unknown; hobkins: unknown; list: AgentSchedule[] | undefined } | null = null

  /** The schedules of this snapshot, or nothing when it has none or they cannot be read. */
  read(snapshot: object | null | undefined): AgentSchedule[] | undefined {
    if (!snapshot || !('agentSchedules' in snapshot)) return undefined
    try {
      const { agentSchedules: from, runs, hobkins } = snapshot as { agentSchedules?: unknown; runs?: unknown; hobkins?: unknown }
      const made = this.made
      if (made && made.from === from && made.runs === runs && made.hobkins === hobkins) return made.list

      const read = readAgentSchedules(from)
      const list = read && withOwnerTitles(read, runs, hobkins)
      this.made = { from, runs, hobkins, list }
      return list
    } catch {
      return undefined
    }
  }

  /** The snapshot as it came from a runtime with no schedules; otherwise with its schedules read, or without them when they cannot be. */
  wire<Snapshot extends object>(snapshot: Snapshot): Snapshot {
    if (!('agentSchedules' in snapshot)) return snapshot
    const agentSchedules = this.read(snapshot)
    return agentSchedules ? { ...snapshot, agentSchedules } : withoutSchedules(snapshot)
  }
}
