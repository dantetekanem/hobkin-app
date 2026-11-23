import { ENDED_SCHEDULE_STATES, type AgentSchedule, type AgentScheduleState } from '#shared/protocol/schedules.ts'

/**
 * The schedules agents keep for themselves (`056-agent-schedules`), as the window words them: which show where, the
 * line near the input, and what a row of its list says. Pure, so every word is tested without a window. Every field
 * but `id` may be missing, from a host that says less: a schedule with no state is taken as waiting.
 */

/** Where a line is: the main chat, which lists every schedule in the home, or one agent's page, which lists its own. */
export type SchedulePlace = { kind: 'main' } | { kind: 'run'; id: string } | { kind: 'hobkin'; id: string }

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const stateOf = (schedule: AgentSchedule): AgentScheduleState => schedule.state ?? 'waiting'

export const isEnded = (schedule: AgentSchedule): boolean => ENDED_SCHEDULE_STATES.includes(stateOf(schedule))

export const isLive = (schedule: AgentSchedule): boolean => !isEnded(schedule)

/** One key for a place, for the one list open at a time. */
export const placeKey = (place: SchedulePlace): string => (place.kind === 'main' ? 'main' : `${place.kind}:${place.id}`)

/** The main chat shows every schedule in the home. A page shows the ones its own agent made. */
export function schedulesIn(all: readonly AgentSchedule[], place: SchedulePlace): readonly AgentSchedule[] {
  if (place.kind === 'main') return all
  return all.filter(({ owner }) => owner?.kind === place.kind && owner.id === place.id)
}

const timeOf = (iso: string | undefined): number | null => {
  if (!iso) return null
  const time = Date.parse(iso)
  return Number.isFinite(time) ? time : null
}

const RANK: Record<AgentScheduleState, number> = { running: 0, waiting: 1, paused: 2, done: 3, cancelled: 3, expired: 3, failed: 3 }

/** Running ones first, then the soonest to fire, then paused ones, then the ended ones, the one that ended last first. */
export function orderSchedules(list: readonly AgentSchedule[]): AgentSchedule[] {
  const nextOf = (schedule: AgentSchedule) => timeOf(schedule.nextAt) ?? Infinity
  const lastOf = (schedule: AgentSchedule) => timeOf(schedule.last?.at) ?? -Infinity
  return [...list].sort((a, b) => {
    const rank = RANK[stateOf(a)] - RANK[stateOf(b)]
    if (rank !== 0) return rank
    if (stateOf(a) === 'waiting') return nextOf(a) - nextOf(b)
    if (isEnded(a)) return lastOf(b) - lastOf(a)
    return 0
  })
}

const two = (value: number) => String(value).padStart(2, '0')

/**
 * The time left before a schedule fires, as a clock reads it: "42s", "1:42", "1:02:05". A moment left still counts as
 * a second. Null once it is due.
 */
export function countdown(ms: number): string | null {
  if (!(ms > 0)) return null
  const seconds = Math.ceil(ms / SECOND)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}:${two(seconds % 60)}`
  return `${Math.floor(minutes / 60)}:${two(minutes % 60)}:${two(seconds % 60)}`
}

/** When it fires next, or how it stands: "in 1:42", "due now", "running", "paused", or how it ended. */
export function whenWords(schedule: AgentSchedule, now: number): string {
  const state = stateOf(schedule)
  if (state !== 'waiting') return state
  const next = timeOf(schedule.nextAt)
  if (next === null) return 'waiting'
  const left = countdown(next - now)
  return left ? `in ${left}` : 'due now'
}

/** The schedule's name, or what it runs, or what it wakes for. */
export function nameOf(schedule: AgentSchedule): string {
  return schedule.name?.trim() || oneLine(schedule.command ?? '') || oneLine(schedule.note ?? '') || 'A schedule'
}

const oneLine = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ↵ ')

export interface ScheduleLineWords {
  /** How many are live: waiting, running or paused. */
  count: number
  /** How the one named stands. `ended` when none is live. */
  lead: 'waiting' | 'running' | 'paused' | 'ended'
  /** The one the line names: the running one, or else the soonest. */
  name: string
  /** What follows the name: "in 1:42", "running", "paused", "due now" or "ended". */
  when: string
  /** The whole line: "2 · Watch CI in 1:42". */
  text: string
  /** The line with no name, where room is short: "2 · 1:42". */
  short: string
}

/**
 * The line near the input. With one schedule, its name and when it fires; with more, how many and the next one; while
 * one runs its command, that it runs. With none live, that they ended. With none at all, nothing.
 */
export function scheduleLine(list: readonly AgentSchedule[], now: number): ScheduleLineWords | null {
  const ordered = orderSchedules(list)
  const live = ordered.filter(isLive)
  const [first] = live
  if (!first) return endedLine(ordered)

  const count = live.length
  const state = stateOf(first)
  const lead = state === 'running' ? 'running' : state === 'paused' ? 'paused' : 'waiting'
  const name = nameOf(first)
  // Paused ones come last, so when the first is paused every live one is.
  if (lead === 'paused' && count > 1) {
    const text = `${count} paused`
    return { count, lead, name, when: 'paused', text, short: text }
  }

  const when = whenWords(first, now)
  const clock = when.startsWith('in ') ? when.slice(3) : when
  const counted = count > 1 ? `${count} · ` : ''
  return { count, lead, name, when, text: `${counted}${name} ${when}`, short: `${counted}${clock}` }
}

/** The line when every schedule has ended: the one that ended last by name, or how many ended. Null with none at all. */
function endedLine(ended: readonly AgentSchedule[]): ScheduleLineWords | null {
  const [newest] = ended
  if (!newest) return null
  const name = nameOf(newest)
  if (ended.length > 1) {
    const text = `${ended.length} ended`
    return { count: 0, lead: 'ended', name, when: 'ended', text, short: text }
  }
  return { count: 0, lead: 'ended', name, when: 'ended', text: `${name} ended`, short: 'ended' }
}

/** How often it fires: "once", "every minute", "every 2 min", "every hour". */
export function everyWords(every: number | undefined): string {
  if (!every || every <= 0) return 'once'
  if (every === 60) return 'every minute'
  if (every === 3600) return 'every hour'
  if (every < 60) return `every ${every}s`
  const minutes = Math.floor(every / 60)
  const seconds = every % 60
  return seconds ? `every ${minutes} min ${seconds}s` : `every ${minutes} min`
}

/** How long ago: "just now", "40s ago", "2 min ago", "3 h ago", "2 d ago". */
export function agoWords(ms: number): string {
  if (ms < 10 * SECOND) return 'just now'
  if (ms < MINUTE) return `${Math.floor(ms / SECOND)}s ago`
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`
  return `${Math.floor(ms / DAY)} d ago`
}

/** A stretch of time: "40s", "28 min", "2 h", "1 h 28 min". */
export function spanWords(ms: number): string {
  const seconds = Math.ceil(ms / SECOND)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`
}

export interface LastRunWords {
  outcome: string
  tone: 'ok' | 'bad' | 'quiet'
  detail: string
}

const OUTCOME: Record<string, Omit<LastRunWords, 'detail'>> = {
  passed: { outcome: 'passed', tone: 'ok' },
  failed: { outcome: 'failed', tone: 'bad' },
  pending: { outcome: 'pending', tone: 'quiet' },
  'timed-out': { outcome: 'timed out', tone: 'bad' },
  error: { outcome: 'could not start', tone: 'bad' },
}

/** What its last run found: how it ended, its exit code, how long ago, and whether it woke the agent. */
export function lastRunWords(schedule: AgentSchedule, now: number): LastRunWords {
  const last = schedule.last
  if (!last) return { outcome: 'not run yet', tone: 'quiet', detail: '' }
  const ended = timeOf(last.at)
  const ago = ended === null ? null : agoWords(Math.max(0, now - ended))
  // A wake runs nothing: what it did was wake the agent.
  if (schedule.does === 'wake' || (!schedule.command && schedule.does !== 'shell')) {
    return { outcome: last.woke === false ? 'did not wake it' : 'woke it', tone: 'quiet', detail: ago ?? '' }
  }
  const { outcome, tone } = OUTCOME[last.outcome] ?? { outcome: last.outcome, tone: 'quiet' }
  const detail = [last.exitCode === undefined ? null : `exit ${last.exitCode}`, ago, last.woke ? 'woke it' : 'no wake'].filter(Boolean).join(' · ')
  return { outcome, tone, detail }
}

/** What a live schedule has left: its runs and the time to its end. Null for an ended one, or one that says neither. */
export function leftWords(schedule: AgentSchedule, now: number): string | null {
  if (isEnded(schedule)) return null
  const runs = schedule.maxRuns === undefined ? null : Math.max(0, schedule.maxRuns - (schedule.runs ?? 0))
  const until = timeOf(schedule.until)
  if (until !== null && until <= now) return 'ends now'
  const time = until === null ? null : spanWords(until - now)
  const runWords = runs === null ? null : `${runs} ${runs === 1 ? 'run' : 'runs'}`
  if (runWords && time) return `${runWords} and ${time} left`
  if (runWords || time) return `${runWords ?? time} left`
  return null
}

/** What it does: the command it runs, or, for a plain wake, what the agent told itself. */
export function doesWords(schedule: AgentSchedule): { kind: 'command' | 'wake'; text: string } {
  if (schedule.does === 'wake' || !schedule.command?.trim()) return { kind: 'wake', text: oneLine(schedule.note ?? '') }
  return { kind: 'command', text: oneLine(schedule.command) }
}

const OWNER: Record<NonNullable<AgentSchedule['owner']>['kind'], string> = { main: 'hobkin', hobkin: 'a durable hobkin', run: 'a run' }

/** Whose it is, as the main chat's list names it. */
export function ownerWords(schedule: AgentSchedule): string {
  return schedule.ownerTitle?.trim() || (schedule.owner ? OWNER[schedule.owner.kind] : 'an agent')
}

const ENDED_WHY: Partial<Record<AgentScheduleState, string>> = {
  done: 'it ran its course',
  cancelled: 'it was cancelled',
  expired: 'its time ran out',
  failed: 'it failed',
}

/** Why an ended schedule ended, in the host's words when it gave them. */
export function endedWords(schedule: AgentSchedule): string {
  return schedule.endedWhy?.trim() || ENDED_WHY[stateOf(schedule)] || 'it ended'
}
