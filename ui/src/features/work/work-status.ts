import type { HoldingKind, WorkState } from '#shared/protocol/work.ts'
import { nextStart, sentence, type WorkloadChange, type WorkloadSetting } from './workload.ts'

/**
 * The line under Work's tiles (_specs/053-work-control-room, "Work"): what work mode does next, or the one thing that
 * holds it and until when, in hobkin's own sentence (`holding.line`), with the one control that changes it. The window
 * adds no rule: a host older than the holding and the outlook keeps today's held and forecast words. Pure, so each
 * hold is tested alone.
 */

export type StatusInput = Pick<WorkState, 'enabled' | 'autoPick' | 'held' | 'forecast'> & Partial<Pick<WorkState, 'holding' | 'outlook' | 'allowance'>>

/** What the line's control does. */
export type StatusAct =
  | { do: 'mode-on' }
  /** Yes to hobkin's open request to add today's amount of tokens again. */
  | { do: 'allowance'; at: string }
  | { do: 'workload'; change: WorkloadChange }
  /** Opens the workload sheet at one of its settings. */
  | { do: 'sheet'; at: WorkloadSetting }

export interface StatusLine {
  /** `go` while work can start, `held` while one thing holds it, `off` with work mode off. */
  tone: 'go' | 'held' | 'off'
  text: string
  control: { label: string; act: StatusAct } | null
}

/**
 * The control each hold offers. A usage limit and a pause have none the window can give: the limit ends by itself, and
 * no window command resumes a pause yet. Nothing queued is not something to change.
 */
const CONTROL: Partial<Record<HoldingKind, StatusLine['control']>> = {
  off: { label: 'Turn on', act: { do: 'mode-on' } },
  tokens: { label: 'Raise tokens a day', act: { do: 'sheet', at: 'dailyTokens' } },
  'hourly-share': { label: 'Raise tokens a day', act: { do: 'sheet', at: 'dailyTokens' } },
  hours: { label: 'Change hours', act: { do: 'sheet', at: 'hours' } },
  cap: { label: 'Raise the cap', act: { do: 'sheet', at: 'changesADay' } },
  'ship-first': { label: 'Turn ship first off', act: { do: 'workload', change: { shipFirst: false } } },
  'auto-pick-off': { label: 'Turn on', act: { do: 'workload', change: { autoPick: true } } },
  'agents-busy': { label: 'More agents', act: { do: 'sheet', at: 'agents' } },
}

/** Today's words for work mode off, from before the line knew what holds it. */
const OFF_WORDS = 'Nothing new starts. Agents that are running finish what they started, and projects, items and branches stay.'

export function statusLine(work: StatusInput, now: number): StatusLine {
  const holding = work.holding
  if (holding) {
    const tone = holding.kind === 'off' ? 'off' : holding.kind === 'nothing-queued' ? 'go' : 'held'
    // Out of today's tokens with hobkin asking for more: the yes to that request is the control.
    const control = holding.kind === 'tokens' && work.allowance ? { label: "Add today's amount again", act: { do: 'allowance', at: work.allowance.at } as const } : (CONTROL[holding.kind] ?? null)
    return { tone, text: holding.line, control }
  }
  if (!work.enabled) return { tone: 'off', text: OFF_WORDS, control: CONTROL.off! }
  if (work.outlook) {
    const { startedToday, moreToday, nextAt } = work.outlook
    const next = nextStart(nextAt, now)
    const sofar = startedToday ? `${startedToday} so far` : ''
    if (!next) return { tone: 'go', text: `Nothing more starts today.${startedToday ? ` ${startedToday} started so far.` : ''}`, control: null }
    const first = next.words === 'now' ? 'The next change starts now.' : sentence(`Next change starts ${next.words}`)
    const more = next.today && moreToday ? ` About ${moreToday} more start today${sofar ? `, ${sofar}` : ''}.` : ''
    return { tone: 'go', text: `${first}${more}`, control: null }
  }
  // A host older than the holding: hobkin's own words for what holds it, or its forecast.
  if (work.held) return { tone: 'held', text: work.held, control: null }
  const text = work.forecast ?? (work.autoPick ? 'The top of the queue starts by itself.' : 'Auto-pick is off, so only what you start runs.')
  return { tone: 'go', text, control: null }
}
