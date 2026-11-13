import { DEPLOY_WORDS, deployOf, deployWhy, type AssessmentStatus, type Deploy } from '#shared/review/assessment.ts'

/**
 * What a finished change's card says about its change review (spec 032): its one answer for the whole change, risky
 * or safe to deploy, how far along a run is, or why it stopped. Pure, so it is tested without a window.
 */

export type BadgeTone = 'bad' | 'warn' | 'ok' | 'quiet'

export interface ReviewBadge {
  label: string
  tone: BadgeTone
  /** The line under the pointer: what it found, what it is doing now, or why it stopped. */
  title: string
  /** Something in the change is critical, and the badge marks it. */
  critical: boolean
}

const TONE: Record<Deploy, BadgeTone> = { risky: 'bad', safe: 'ok' }

export function reviewBadge(status: AssessmentStatus | undefined): ReviewBadge {
  if (status?.state === 'ready' && status.summary) {
    const { summary } = status
    // One answer for the whole change. How many parts sit at which level is how the review got there, not what it says.
    const deploy = deployOf(summary)
    return { label: DEPLOY_WORDS[deploy], tone: TONE[deploy], title: deployWhy(summary), critical: summary.critical }
  }
  if (status?.state === 'running') {
    const label = status.percent == null ? 'Reviewing' : `Reviewing · ${Math.round(status.percent)}%`
    return { label, tone: 'quiet', title: status.now ?? 'The change review is under way.', critical: false }
  }
  if (status?.state === 'queued') return { label: 'Review queued', tone: 'quiet', title: 'Waiting its turn.', critical: false }
  if (status?.state === 'failed') return { label: 'Review failed', tone: 'quiet', title: status.error ?? 'The change review stopped before it finished.', critical: false }
  return { label: 'Not reviewed yet', tone: 'quiet', title: 'No change review has run at this commit yet.', critical: false }
}

/** The change review says it is risky to deploy, so the card's merge stands back. */
export function saysHigh(status: AssessmentStatus | undefined): boolean {
  return status?.state === 'ready' && status.summary != null && deployOf(status.summary) === 'risky'
}
