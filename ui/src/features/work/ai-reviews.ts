import type { AssessmentSummary } from '#shared/review/assessment.ts'
import { targetOfReviewId } from '#shared/review/ids.ts'
import type { ReviewList, ReviewListItem } from '#shared/review/status.ts'

/**
 * The AI Reviews tab's data (spec 032): every review the host knows (`review.list`), finished changes and pull
 * requests together, sorted into what is running, what is ready and what failed, each newest first. A review that
 * never ran is left out. Pure, so it is tested without a window.
 */

export type { ReviewList, ReviewListItem }

export type ReviewGroup = 'running' | 'ready' | 'failed'

export interface ReviewRow {
  item: ReviewListItem
  group: ReviewGroup
  /** The project, or `owner/repo #n` for a pull request. */
  where: string
  /** What it is doing now, for a running one; why it stopped, for a failed one; empty for a ready one. */
  line: string
  /** How far along a running one is, from 0 to 100, when it says. */
  percent: number | null
  /** When a running one started, in milliseconds. Null while it waits its turn. */
  startedAt: number | null
  /** When a ready one finished, or a failed one stopped, in milliseconds. */
  at: number | null
  /** A ready change review's summary: its answer for the change, and why. Null when it has none. */
  summary: AssessmentSummary | null
}

export interface ReviewGroups {
  running: ReviewRow[]
  ready: ReviewRow[]
  failed: ReviewRow[]
}

const PHASES: Record<string, string> = { queued: 'Waiting its turn', reading: 'Reading the change', arranging: 'Arranging the story', checking: 'Checking the result' }

const timeOf = (iso: string | null | undefined): number | null => {
  const at = Date.parse(iso ?? '')
  return Number.isFinite(at) ? at : null
}

/** Running beats failed, so a review asked for again after it stopped shows as running. One that never ran has no group. */
export function groupOf(item: ReviewListItem): ReviewGroup | null {
  const assessment = item.assessment?.state
  if (item.state === 'preparing' || assessment === 'queued' || assessment === 'running') return 'running'
  if (item.state === 'failed' || assessment === 'failed') return 'failed'
  if (item.state === 'ready' || assessment === 'ready') return 'ready'
  return null
}

/** The project, or `owner/repo #n` for a pull request, as the host names its repository. */
function whereOf(item: ReviewListItem): string {
  const target = targetOfReviewId(item.id)
  if (target?.kind !== 'pull') return item.project
  return `${item.project || `${target.owner}/${target.repo}`} #${target.number}`
}

function rowOf(item: ReviewListItem): ReviewRow | null {
  const group = groupOf(item)
  if (!group) return null
  const { assessment } = item
  const running = assessment?.state === 'running'
  const row: ReviewRow = { item, group, where: whereOf(item), line: '', percent: null, startedAt: null, at: null, summary: null }
  if (group === 'running') {
    const waiting = assessment?.state === 'queued' ? 'Waiting its turn' : 'Starting'
    row.line = (running ? assessment.now : undefined) ?? (item.phase ? PHASES[item.phase] : undefined) ?? waiting
    row.percent = running && assessment.percent != null ? Math.min(100, Math.max(0, Math.round(assessment.percent))) : null
    // The change review's own start, once it runs; before that, the start of the review it is built on.
    row.startedAt = (running ? timeOf(assessment.startedAt) : null) ?? (item.state === 'preparing' ? timeOf(item.startedAt) : null)
  } else if (group === 'failed') {
    row.line = (assessment?.state === 'failed' ? assessment.error : undefined) ?? item.error ?? 'It stopped before it finished.'
    row.at = timeOf(item.updatedAt)
  } else {
    row.summary = assessment?.state === 'ready' ? (assessment.summary ?? null) : null
    row.at = timeOf(row.summary?.at) ?? timeOf(item.updatedAt)
  }
  return row
}

/** When a row last moved: a running one when it started, or when it was asked for while it waits; the rest when they ended. */
const momentOf = (row: ReviewRow) => row.startedAt ?? row.at ?? timeOf(row.item.updatedAt) ?? 0
const newestFirst = (rows: ReviewRow[]) => rows.sort((a, b) => momentOf(b) - momentOf(a))

/** Every review that ran or runs, newest first. */
export function rowsOf(list: ReviewList | null): ReviewRow[] {
  return newestFirst((list?.reviews ?? []).flatMap((item) => rowOf(item) ?? []))
}

/** Running first, then ready, then failed, each newest first. Of the running ones, those under way come before those still waiting. */
export function groupReviews(list: ReviewList | null): ReviewGroups {
  const groups: ReviewGroups = { running: [], ready: [], failed: [] }
  for (const row of rowsOf(list)) groups[row.group].push(row)
  groups.running = [...groups.running.filter(({ startedAt }) => startedAt !== null), ...groups.running.filter(({ startedAt }) => startedAt === null)]
  return groups
}

export function reviewCounts(groups: ReviewGroups): Record<ReviewGroup, number> {
  return { running: groups.running.length, ready: groups.ready.length, failed: groups.failed.length }
}

/** A review that ran can be run again: one that is ready, or one that stopped. One under way is already being built. */
export const canReviewAgain = (row: ReviewRow) => row.group !== 'running'

/** The review a row opens. Without a host a finished change opens the sample review, as its Work card does. */
export function reviewToOpen(item: ReviewListItem, live: boolean): string {
  return live || item.kind === 'pull' ? item.id : 'sample'
}
