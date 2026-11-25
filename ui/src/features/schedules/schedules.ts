import { ENDED_SCHEDULE_STATES, type AgentSchedule, type AgentScheduleState } from '#shared/protocol/schedules.ts'

/**
 * The schedules agents keep for themselves (`056-agent-schedules`), as the window words them: which show where, the
 * line near the input, and what a row of its list says. Pure, so every word is tested without a window. Every field
 * but `id` may be missing, from a host that says less: a schedule with no state is taken as waiting.
 */

/** Where a line is: the main chat or one agent's page, each listing the schedules its own agent made. */
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

/** Each place shows the schedules its own agent made: the main chat its own, a page its agent's. An agent's is never in the main chat. */
export function schedulesIn(all: readonly AgentSchedule[], place: SchedulePlace): readonly AgentSchedule[] {
  if (place.kind === 'main') return all.filter(({ owner }) => owner?.kind === 'main')
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

/** Days and the hours past them: "3 d", "2 d 3 h". */
const daysWords = (ms: number) => {
  const days = Math.floor(ms / DAY)
  const hours = Math.floor((ms % DAY) / HOUR)
  return hours ? `${days} d ${hours} h` : `${days} d`
}

/**
 * The time left before a schedule fires, as a clock reads it: "42s", "1:42", "1:02:05", and a day or more in days and
 * hours, "2 d 3 h", which change seldom. A moment left still counts as a second. Null once it is due.
 */
export function countdown(ms: number): string | null {
  if (!(ms > 0)) return null
  if (ms >= DAY) return daysWords(ms)
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
  lead: 'waiting' | 'running' | 'paused'
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
  // With nothing live the line is not drawn (the user, 2026-11-24).
  if (!first) return null

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

/** The line glows while a schedule runs its command or is due now (`glow.ts` in agent-activity holds the other lines' rules). */
export const schedulesGlow = (list: readonly AgentSchedule[], now: number): boolean =>
  list.some((schedule) => stateOf(schedule) === 'running' || whenWords(schedule, now) === 'due now')

/** How often it fires: "once", "every minute", "every 2 min", "every hour", "every 6 h", "every day", "every 1 d 12 h". */
export function everyWords(every: number | undefined): string {
  if (!every || every <= 0) return 'once'
  if (every === 60) return 'every minute'
  if (every === 3600) return 'every hour'
  if (every === 86400) return 'every day'
  if (every < 60) return `every ${every}s`
  if (every * SECOND >= DAY) return `every ${daysWords(every * SECOND)}`
  if (every > 3600) return `every ${spanWords(every * SECOND)}`
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

/** A stretch of time: "40s", "28 min", "2 h", "1 h 28 min", and a day or more "3 d" or "1 d 12 h". */
export function spanWords(ms: number): string {
  if (ms >= DAY) return daysWords(ms)
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
  // A run that did not end by itself, such as one cut off by a restart, says what happened in the runtime's words.
  if (last.outcome === 'error') {
    const said = sentenceOf(last.line ?? '')
    const detail = [ago, last.woke ? 'woke it' : null].filter(Boolean).join(' · ')
    return { outcome: said || 'could not start', tone: 'bad', detail }
  }
  const { outcome, tone } = OUTCOME[last.outcome] ?? { outcome: last.outcome, tone: 'quiet' }
  const detail = [last.exitCode === undefined ? null : `exit ${last.exitCode}`, ago, last.woke ? 'woke it' : 'no wake'].filter(Boolean).join(' · ')
  return { outcome, tone, detail }
}

/** A sentence as part of a line: its first letter small and its last stop gone, "It was cut off." as "it was cut off". */
const sentenceOf = (text: string) => {
  const words = text.trim().replace(/\.$/, '')
  return words.charAt(0).toLowerCase() + words.slice(1)
}

/**
 * What a live schedule has left: its runs and the time to its end. One with no end time has no end: its agent gave it
 * none, as a host that sends `until` for every other one says by leaving it out. Null for an ended one.
 */
export function leftWords(schedule: AgentSchedule, now: number): string | null {
  if (isEnded(schedule)) return null
  const runs = schedule.maxRuns === undefined ? null : Math.max(0, schedule.maxRuns - (schedule.runs ?? 0))
  const until = timeOf(schedule.until)
  if (until !== null && until <= now) return 'ends now'
  const runWords = runs === null ? null : `${runs} ${runs === 1 ? 'run' : 'runs'}`
  if (until === null) return runWords ? `${runWords} left, no end` : 'no end'
  const time = spanWords(until - now)
  return runWords ? `${runWords} and ${time} left` : `${time} left`
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
