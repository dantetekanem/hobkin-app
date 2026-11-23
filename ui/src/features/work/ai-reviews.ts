import type { AssessmentSummary } from '#shared/review/assessment.ts'
import { pullOfReview, pullUrl } from '#shared/review/ids.ts'
import { shownAsRow, type ReviewList, type ReviewListItem } from '#shared/review/status.ts'

/**
 * The AI Reviews tab's data (spec 032): every review the host knows (`review.list`), finished changes and pull
 * requests together, sorted into what is running, what is ready and what failed, each newest first. A review that
 * never ran is left out, unless the host says it waits its turn. Pure, so it is tested without a window.
 */

export type { ReviewList, ReviewListItem }

/** `unmerged`: the user said merge and it has not merged. It comes before everything else. */
export type ReviewGroup = 'unmerged' | 'running' | 'ready' | 'failed'

export interface ReviewRow {
  item: ReviewListItem
  group: ReviewGroup
  /** The project, or `owner/repo` for a pull request, with the number of the pull request the review has. */
  where: string
  /** The page of the pull request the review has: its own, or the one its finished change opened. Null when it has none. */
  link: string | null
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
  unmerged: ReviewRow[]
  running: ReviewRow[]
  ready: ReviewRow[]
  failed: ReviewRow[]
}

const PHASES: Record<string, string> = { queued: 'Waiting its turn', reading: 'Reading the change', arranging: 'Arranging the story', checking: 'Checking the result' }

const timeOf = (iso: string | null | undefined): number | null => {
  const at = Date.parse(iso ?? '')
  return Number.isFinite(at) ? at : null
}

/**
 * A merge the user asked for that has not happened comes before all else: it is the one row they are waiting on.
 * Running beats failed, so a review asked for again after it stopped shows as running, and so does a finished change
 * the host says waits its turn. One that never ran and waits for nothing has no group.
 */
export function groupOf(item: ReviewListItem): ReviewGroup | null {
  if (!shownAsRow(item)) return null
  if (item.mergeAsked) return 'unmerged'
  const assessment = item.assessment?.state
  if (item.state === 'preparing' || assessment === 'queued' || assessment === 'running' || item.waiting) return 'running'
  if (item.state === 'failed' || assessment === 'failed') return 'failed'
  if (item.state === 'ready' || assessment === 'ready') return 'ready'
  return null
}

/**
 * Where a review's change lives: its name, which is the project, or `owner/repo` for a pull request as the host names
 * its repository, with the number of the pull request it has, and that pull request's page.
 */
function placeOf(item: ReviewListItem): Pick<ReviewRow, 'where' | 'link'> {
  const pull = pullOfReview(item.id, item.pr)
  if (!pull) return { where: item.project, link: null }

  const name = item.project || `${pull.owner}/${pull.repo}`
  return { where: `${name} #${pull.number}`, link: pullUrl(pull) }
}

function rowOf(item: ReviewListItem): ReviewRow | null {
  const group = groupOf(item)
  if (!group) return null
  const { assessment } = item
  const running = assessment?.state === 'running'
  const row: ReviewRow = { item, group, ...placeOf(item), line: '', percent: null, startedAt: null, at: null, summary: null }
  if (group === 'unmerged') {
    const { state, why, at, message } = item.mergeAsked!
    // A code host that merges in its own time says what it does; a finished change waits for hobkin to bring it up to date.
    const waits = message ? `You said merge. ${message}` : 'You said merge. hobkin is bringing it up to date, and merges it after that.'
    row.line = state === 'waiting' ? waits : `You said merge, and it did not merge: ${why ?? 'no reason was given.'}`
    row.at = timeOf(at)
    row.summary = assessment?.state === 'ready' ? (assessment.summary ?? null) : null
  } else if (group === 'running') {
    const waiting = assessment?.state === 'queued' || item.waiting ? 'Waiting its turn' : 'Starting'
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
  const groups: ReviewGroups = { unmerged: [], running: [], ready: [], failed: [] }
  for (const row of rowsOf(list)) groups[row.group].push(row)
  groups.running = [...groups.running.filter(({ startedAt }) => startedAt !== null), ...groups.running.filter(({ startedAt }) => startedAt === null)]
  return groups
}

export function reviewCounts(groups: ReviewGroups): Record<ReviewGroup, number> {
  return { unmerged: groups.unmerged.length, running: groups.running.length, ready: groups.ready.length, failed: groups.failed.length }
}

/** A review that ran can be run again: one that is ready, or one that stopped. One under way is already being built. */
export const canReviewAgain = (row: ReviewRow) => row.group !== 'running' && !(row.group === 'unmerged' && ['queued', 'running'].includes(row.item.assessment?.state ?? ''))

/** The review a row opens. Without a host a finished change opens the sample review, as its Work card does. */
export function reviewToOpen(item: ReviewListItem, live: boolean): string {
  return live || item.kind === 'pull' ? item.id : 'sample'
}
