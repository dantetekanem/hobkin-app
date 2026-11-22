import type { ReviewPulls, WorkHours, Workload, WorkState } from '#shared/protocol/work.ts'
import { clockTime } from '../reports/time.ts'
import type { WorkAction } from './actions.ts'

/**
 * The workload sheet's rules (_specs/053-work-control-room, "Workload"): its eight settings as hobkin keeps them, what
 * each control shows for a setting and the change it sends back, the forecast under them, and when W opens the sheet.
 * Pure, so each is tested alone. The host checks every value again; what it refuses shows by the setting.
 */

/** The sheet's rows, in their order. Ship first's number is part of its row. */
export const WORKLOAD_ROWS = ['agents', 'autoPick', 'changesADay', 'dailyTokens', 'hours', 'shipFirst', 'reviewOnFinish', 'reviewPulls'] as const
export type WorkloadSetting = (typeof WORKLOAD_ROWS)[number]

/** A change to one or more settings, as the sheet makes it. */
export type WorkloadChange = Partial<Workload>

/** hobkin's defaults, for a host that does not send the workload: what a home that set nothing runs with. */
export const WORKLOAD_DEFAULTS: Workload = {
  agents: 2,
  autoPick: false,
  changesADay: null,
  dailyTokens: 100_000_000,
  hours: null,
  shipFirst: true,
  shipFirstAt: 8,
  reviewOnFinish: false,
  reviewPulls: 'none',
}

/**
 * The workload as it stands. A host older than the workload sends none: then agents, auto-pick and tokens come from
 * what the work state says, the rest are hobkin's defaults, and `known` is false.
 */
export function workloadOf(work: Pick<WorkState, 'workload' | 'agentsAllowed' | 'autoPick' | 'dailyTokens'>): { settings: Workload; known: boolean } {
  if (work.workload) return { settings: work.workload, known: true }
  return {
    settings: {
      ...WORKLOAD_DEFAULTS,
      agents: work.agentsAllowed,
      autoPick: work.autoPick,
      dailyTokens: work.dailyTokens ?? WORKLOAD_DEFAULTS.dailyTokens,
    },
    known: false,
  }
}

/** The action a change sends: agents at once and tokens a day have their own commands; the rest go to `work.workload` together. */
export function workloadAction(change: WorkloadChange): WorkAction {
  const { agents, dailyTokens, ...rest } = change
  if (agents !== undefined) return { do: 'agents', agents }
  if (dailyTokens !== undefined) return { do: 'tokens', tokens: dailyTokens }
  return { do: 'workload', change: rest }
}

const MILLION = 1_000_000

/** Tokens a day as the sheet shows them: whole millions. */
export const millionsOf = (tokens: number): number => Math.max(1, Math.round(tokens / MILLION))

/** What the user typed for tokens a day, as tokens: a whole number of millions from 1 up, with or without its M. Null otherwise. */
export function tokensFromWords(words: string): number | null {
  const match = /^\s*(\d+)\s*m?\s*$/i.exec(words)
  if (!match) return null
  const millions = Number(match[1])
  return millions >= 1 && Number.isSafeInteger(millions * MILLION) ? millions * MILLION : null
}

/** Which pull requests get an AI review by themselves, as the sheet's two toggles show it. */
export const pullsShown = (pulls: ReviewPulls): { mine: boolean; waiting: boolean } => ({
  mine: pulls === 'mine' || pulls === 'both',
  waiting: pulls === 'waiting' || pulls === 'both',
})

/** The two toggles back as the setting. */
export function pullsOf({ mine, waiting }: { mine: boolean; waiting: boolean }): ReviewPulls {
  if (mine && waiting) return 'both'
  if (mine) return 'mine'
  return waiting ? 'waiting' : 'none'
}

const ROUND_CAPS = [3, 5, 10, 20]

/** The choices of the cap on changes a day: none, a few round numbers, and the one set now when it is another. */
export function capChoices(current: number | null): { value: string; label: string }[] {
  const offered = current === null ? ROUND_CAPS : [...ROUND_CAPS, current]
  const numbers = [...new Set(offered)].sort((a, b) => a - b)
  return [{ value: 'none', label: 'No cap' }, ...numbers.map((number) => ({ value: String(number), label: String(number) }))]
}

export const capValue = (cap: number | null): string => (cap === null ? 'none' : String(cap))
export const capOf = (value: string): number | null => (value === 'none' ? null : Number(value))

/** The window of hours a first "Set hours" offers. */
export const OFFICE_HOURS: WorkHours = { from: '09:00', to: '18:00' }

/** Two ends of a window of hours, as the time fields give them, or why they cannot be one. */
export function hoursFrom(from: string, to: string): WorkHours | { refused: string } {
  const clock = /^([01]\d|2[0-3]):[0-5]\d$/
  if (!clock.test(from) || !clock.test(to)) return { refused: 'Give both times as hours and minutes.' }
  if (from === to) return { refused: 'The start and the end must differ.' }
  return { from, to }
}

/** A sentence ended once, even after a time the locale writes with its own last period ("9:05 a.m."). */
export const sentence = (words: string): string => (/[.!?]$/.test(words) ? words : `${words}.`)

/**
 * The forecast under the settings: about how many changes start today and when the next one does, from hobkin's outlook.
 * A host older than the outlook leaves it to hobkin's own forecast line.
 */
export function forecastWords(work: Pick<WorkState, 'outlook' | 'forecast'>, now: number): string {
  const outlook = work.outlook
  if (!outlook) return work.forecast ?? 'This host does not forecast the workload yet.'
  const total = outlook.startedToday + outlook.moreToday
  const soFar = outlook.startedToday ? `, ${outlook.startedToday} so far` : ''
  const today = `With this, about ${total} ${total === 1 ? 'change starts' : 'changes start'} today${soFar}.`
  const next = nextStart(outlook.nextAt, now)
  const then = next ? sentence(`Next start ${next.words}`) : 'No more start today.'
  return `${today} ${then}`
}

const startOfDay = (at: number) => new Date(at).setHours(0, 0, 0, 0)
const DAY_MS = 86_400_000

/** When the next change starts, in words ("now", "at 14:20", "tomorrow at 09:05"), and whether that is today. Null with none. */
export function nextStart(nextAt: string | null, now: number): { words: string; today: boolean } | null {
  const at = nextAt ? Date.parse(nextAt) : Number.NaN
  if (!Number.isFinite(at)) return null
  if (at <= now + 30_000) return { words: 'now', today: true }
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY_MS)
  const day = days === 0 ? '' : days === 1 ? 'tomorrow ' : `${new Intl.DateTimeFormat('en', { weekday: 'long' }).format(at)} `
  return { words: `${day}at ${clockTime(at)}`, today: days === 0 }
}

/** A key press as W reads it: `handled` when something else used the key, `typing` while a field is being typed in. */
interface KeyPress {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  repeat: boolean
  handled: boolean
  typing: boolean
}

/** A key that W opens the workload with: W alone, once, while no field is being typed in and nothing used the key. */
export function opensWorkload(press: KeyPress): boolean {
  const plainW = (press.key === 'w' || press.key === 'W') && !press.metaKey && !press.ctrlKey && !press.altKey
  return plainW && !press.repeat && !press.handled && !press.typing
}
