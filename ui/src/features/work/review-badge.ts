import { LEVEL_WORDS, type AssessmentStatus, type AssessmentSummary, type Level } from '#shared/review/assessment.ts'

/**
 * What a finished change's card says about its change review (spec 032): the level it found, in the Review page's
 * words, how far along a run is, or why it stopped. Pure, so it is tested without a window.
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

const TONE: Record<Level, BadgeTone> = { high: 'bad', mid: 'warn', safe: 'ok' }

/** The level in words, with how many units need the user or are worth a look when there are more than one. */
function labelOf({ level, needsYou, worthALook }: AssessmentSummary): string {
  const counts: Record<Level, number> = { high: needsYou, mid: worthALook, safe: 0 }
  const count = counts[level]
  return count > 1 ? `${LEVEL_WORDS[level]} · ${count}` : LEVEL_WORDS[level]
}

/** "Change review: 2 units need you, 1 is worth a look and 4 are safe." */
function foundOf({ needsYou, worthALook, safe, critical }: AssessmentSummary): string {
  const levels = [
    [needsYou, 'needs you', 'need you'],
    [worthALook, 'is worth a look', 'are worth a look'],
    [safe, 'is safe', 'are safe'],
  ] as const
  // Only the first phrase names the unit: "2 units need you, 1 is worth a look and 4 are safe".
  const counts = levels
    .filter(([count]) => count > 0)
    .map(([count, one, many], index) => {
      const unit = index === 0 ? (count === 1 ? ' unit' : ' units') : ''
      return `${count}${unit} ${count === 1 ? one : many}`
    })
  const found = counts.length
    ? `${counts.slice(0, -1).join(', ')}${counts.length > 1 ? ' and ' : ''}${counts.at(-1)}.`
    : 'nothing in it needs reading.'
  return `Change review: ${found}${critical ? ' Something in it is critical.' : ''}`
}

export function reviewBadge(status: AssessmentStatus | undefined): ReviewBadge {
  if (status?.state === 'ready' && status.summary) {
    const { summary } = status
    return { label: labelOf(summary), tone: TONE[summary.level], title: foundOf(summary), critical: summary.critical }
  }
  if (status?.state === 'running') {
    const label = status.percent == null ? 'Reviewing' : `Reviewing · ${Math.round(status.percent)}%`
    return { label, tone: 'quiet', title: status.now ?? 'The change review is under way.', critical: false }
  }
  if (status?.state === 'queued') return { label: 'Review queued', tone: 'quiet', title: 'Waiting its turn: one change review runs at a time.', critical: false }
  if (status?.state === 'failed') return { label: 'Review failed', tone: 'quiet', title: status.error ?? 'The change review stopped before it finished.', critical: false }
  return { label: 'Not reviewed yet', tone: 'quiet', title: 'No change review has run at this commit yet.', critical: false }
}

/** The change review found something that needs the user, so the card's merge stands back. */
export function saysHigh(status: AssessmentStatus | undefined): boolean {
  return status?.state === 'ready' && status.summary?.level === 'high'
}
