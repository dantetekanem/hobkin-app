import type { HoldingKind, WorkHolding, WorkOutlook, WorkState } from '#shared/protocol/work.ts'
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
 * The control each hold offers. A usage limit ends by itself, and nothing the window sends ends it. Of the pauses, only
 * one by hand has a control: `work.mode` on ends it (`startWork` in hobkin clears it). One to protect the subscription
 * ends at its time, and a pause of every project is each project's own switch. Nothing queued is not something to change.
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

/** A pause by hand, told apart from the other pauses by hobkin's words: it has no end time, and says so. */
const byHand = (holding: WorkHolding) => holding.kind === 'paused' && holding.until === null && /^Paused by hand\b/.test(holding.line)

/** The control for what holds work mode. Out of today's tokens with hobkin asking for more, the yes to that request is the control. */
function holdControl(holding: WorkHolding, allowance: StatusInput['allowance']): StatusLine['control'] {
  if (holding.kind === 'tokens' && allowance) return { label: "Add today's amount again", act: { do: 'allowance', at: allowance.at } }
  if (byHand(holding)) return { label: 'Resume', act: { do: 'mode-on' } }
  return CONTROL[holding.kind] ?? null
}

/** When the next change starts, and about how many more start today, as hobkin's outlook sees it. */
function outlookWords({ startedToday, moreToday, nextAt }: WorkOutlook, now: number): string {
  const next = nextStart(nextAt, now)
  if (!next) return `Nothing more starts today.${startedToday ? ` ${startedToday} started so far.` : ''}`

  const first = next.words === 'now' ? 'The next change starts now.' : sentence(`Next change starts ${next.words}`)
  if (!next.today || !moreToday) return first
  const soFar = startedToday ? `, ${startedToday} so far` : ''
  return `${first} About ${moreToday} more start today${soFar}.`
}

/** The words for work mode off from a host that does not say what holds it. */
const OFF_WORDS = 'Nothing new starts. Agents that are running finish what they started, and projects, items and branches stay.'

export function statusLine(work: StatusInput, now: number): StatusLine {
  const holding = work.holding
  if (holding) {
    const tone = holding.kind === 'off' ? 'off' : holding.kind === 'nothing-queued' ? 'go' : 'held'
    return { tone, text: holding.line, control: holdControl(holding, work.allowance) }
  }
  if (!work.enabled) return { tone: 'off', text: OFF_WORDS, control: CONTROL.off! }
  if (work.outlook) return { tone: 'go', text: outlookWords(work.outlook, now), control: null }
  // A host older than the holding: hobkin's own words for what holds it, or its forecast.
  if (work.held) return { tone: 'held', text: work.held, control: null }
  const text = work.forecast ?? (work.autoPick ? 'The top of the queue starts by itself.' : 'Auto-pick is off, so only what you start runs.')
  return { tone: 'go', text, control: null }
}
