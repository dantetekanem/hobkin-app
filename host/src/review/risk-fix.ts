/**
 * What hobkin does when the AI review of its own finished change says risky to deploy (spec 032, A37 to A39): it sends
 * an agent back to make the change safe, once for each commit and at most twice for a change, then leaves it to the
 * user with one Action Item. A pull request is never sent back, since only hobkin's own work items are its to fix, and
 * neither is a commit the user gave a verdict on. What was done is kept in the home beside the change's reviews, so a
 * restart sends nothing twice. Both answers here are pure.
 */
import type { RiskFix } from '#shared/review/assessment.ts'

/** How many times hobkin sends an agent back to one change before it is the user's. */
export const RISK_ROUNDS = 2

/** What was done about a change's risky answers. */
export interface RiskRecord {
  /** Each time an agent went back, at the commit the review that sent it was of. */
  rounds: { head: string; at: string }[]
  /** The commits the user gave a verdict on. hobkin sends nothing for those. */
  answered: string[]
  /** hobkin stopped: at which commit, why, and the Action Item that says what the user must do. */
  waiting: { head: string; at: string; why: 'rounds' | 'unchanged'; action: string | null } | null
}

export const NO_RISK_RECORD: RiskRecord = { rounds: [], answered: [], waiting: null }

/** Where hobkin's own work on a change stands now, as its items and the Work screen have it. */
export interface RiskWork {
  /** `working`: back in the queue or running. `finished`: a finished branch or PR. `over`: merged, said no to, dropped or gone. */
  at: 'working' | 'finished' | 'over'
  /** The commit its finished card is at, when it has one. */
  head: string | null
  /** What its last run left for the user, on a "Left for you" card. */
  left: string | null
  /** Why work mode starts nothing on its project now, in hobkin's words. Null while it runs. */
  held: string | null
}

export type RiskStep = { do: 'send'; round: number } | { do: 'stay'; why: 'rounds' | 'unchanged' } | null

/**
 * What to do about a change whose review at `head` says risky to deploy: send the next round, leave it to the user, or
 * nothing. Only a finished change at that very commit, with nothing left for the user, is acted on. A round that came
 * back at the commit it went for changed nothing, so the change is the user's; so it is once its rounds are spent.
 * While work mode starts nothing on the project, nothing is sent: it goes once work mode runs.
 */
export function riskStep(record: RiskRecord, head: string, work: RiskWork): RiskStep {
  if (work.at !== 'finished' || work.head !== head || work.left) return null
  if (record.answered.includes(head) || record.waiting?.head === head) return null
  if (record.rounds.some((round) => round.head === head)) return { do: 'stay', why: 'unchanged' }
  if (record.rounds.length >= RISK_ROUNDS) return { do: 'stay', why: 'rounds' }
  if (work.held) return null
  return { do: 'send', round: record.rounds.length + 1 }
}

/** What the window says hobkin does about a risky answer at `head`, or undefined when it does nothing for it. */
export function riskShown(record: RiskRecord, head: string, work: RiskWork | null): RiskFix | undefined {
  if (!work || work.at === 'over' || record.answered.includes(head)) return undefined
  const base = { rounds: RISK_ROUNDS }
  const sent = record.rounds.findIndex((round) => round.head === head)
  const round = sent >= 0 ? sent + 1 : record.rounds.length
  if (record.waiting?.head === head) return { ...base, state: 'waiting', round, why: record.waiting.why, ...(record.waiting.action ? { action: record.waiting.action } : {}) }
  if (work.at === 'finished' && work.left && (sent >= 0 || work.head === head)) return { ...base, state: 'waiting', round, why: 'left' }
  if (sent >= 0) {
    if (work.at === 'working') return { ...base, state: 'fixing', round, ...(work.held ? { held: work.held } : {}) }
    return work.head === head ? { ...base, state: 'waiting', round, why: 'unchanged' } : { ...base, state: 'fixed', round }
  }
  // Not sent for this commit: what is sent next, or why not yet.
  if (work.at !== 'finished' || work.head !== head) return undefined
  if (record.rounds.length >= RISK_ROUNDS) return { ...base, state: 'waiting', round, why: 'rounds' }
  return work.held ? { ...base, state: 'fixing', round: round + 1, held: work.held } : undefined
}
