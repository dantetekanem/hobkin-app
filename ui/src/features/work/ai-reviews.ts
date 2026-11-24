import type { Grade } from '#shared/protocol/work.ts'
import type { AssessmentSummary } from '#shared/review/assessment.ts'
import { pullOfReview, pullUrl } from '#shared/review/ids.ts'
import { readCarried, readOutdated, readRepoLines, readTurn, shownAsRow, type ReviewList, type ReviewListItem, type ReviewTurn } from '#shared/review/status.ts'
import { needNumbers, type NeedNumbers } from '../review/panel/needs.ts'
import { GRADE_ORDER } from './projects.ts'

/**
 * The AI Reviews tab's data (spec 032): every review the host knows (`review.list`), finished changes and pull
 * requests together, sorted into what is running, what is ready and what failed, each in the order the user picked,
 * newest first unless they picked another. A review that never ran is left out, unless the host says it waits its
 * turn. Pure, so it is tested without a window.
 */

export type { ReviewList, ReviewListItem }

/** `unmerged`: the user said merge and it has not merged. It comes before everything else. */
export type ReviewGroup = 'unmerged' | 'running' | 'ready' | 'failed'

/**
 * The order of each group's rows. `priority`: the most pressing work first, and of two that press the same, the one
 * that has waited longest, as in a queue; a review with no priority comes last. `newest` and `oldest` go by when a row
 * last moved.
 */
export type ReviewOrder = 'priority' | 'newest' | 'oldest'

export const REVIEW_ORDERS: readonly { value: ReviewOrder; label: string }[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
]

/** The priority of the work a review is of, or null when it has none, as a pull request has none. */
export type PriorityOf = (item: ReviewListItem) => Grade | null

/** How the list is put in order: the order picked, and where a review's priority is read. */
export interface ReviewOrdering {
  order: ReviewOrder
  priorityOf: PriorityOf
}

export interface ReviewRow {
  item: ReviewListItem
  group: ReviewGroup
  /** The project, or `owner/repo` for a pull request, with the number of the pull request the review has. */
  where: string
  /** The page of the pull request the review has: its own, or the one its finished change opened. Null when it has none. */
  link: string | null
  /** The priority of the work it is of. Null when it has none. */
  priority: Grade | null
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
  /** The general rate hobkin's scored review gave a finished change. Null when it was not scored. */
  rate: number | null
  /** The review's own answers to the user's five questions, and its rate (spec 058). Null when it is not rated. */
  needs: NeedNumbers | null
  /** Where it stands in its repository's line, when the background does not build it now (spec 058). */
  turn: ReviewTurn | null
  /** For an outdated review, the commit it was built for; for a carried one, where it was carried from and why it holds. */
  standing: string | null
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

const short = (commit: string) => commit.slice(0, 7)

/** What an outdated or a carried review says of the commit it was built for, read without trust. Null for any other. */
function standingOf(item: ReviewListItem, turn: ReviewTurn | null): string | null {
  const outdated = readOutdated(item.outdated)
  if (outdated) return [`Outdated: built for ${short(outdated.builtFor)}.`, turn?.why].filter(Boolean).join(' ')
  const carried = readCarried(item.carried)
  if (carried) return `Carried from ${short(carried.from)}, not built again. ${carried.why}`
  return null
}

function rowOf(item: ReviewListItem, priorityOf: PriorityOf): ReviewRow | null {
  const group = groupOf(item)
  if (!group) return null
  const { assessment } = item
  const running = assessment?.state === 'running'
  const turn = readTurn(item.turn) ?? null
  const row: ReviewRow = {
    item,
    group,
    ...placeOf(item),
    priority: priorityOf(item),
    line: '',
    percent: null,
    startedAt: null,
    at: null,
    summary: null,
    rate: item.rate ?? null,
    needs: needNumbers(item.needs, item.head ?? undefined),
    turn,
    standing: standingOf(item, turn),
  }
  if (group === 'unmerged') {
    const { state, why, at, message } = item.mergeAsked!
    // A code host that merges in its own time says what it does; a finished change waits for hobkin to bring it up to date.
    const waits = message ? `You said merge. ${message}` : 'You said merge. hobkin is bringing it up to date, and merges it after that.'
    row.line = state === 'waiting' ? waits : `You said merge, and it did not merge: ${why ?? 'no reason was given.'}`
    row.at = timeOf(at)
    row.summary = assessment?.state === 'ready' ? (assessment.summary ?? null) : null
  } else if (group === 'running') {
    const waiting = turn?.why ?? (assessment?.state === 'queued' || item.waiting ? 'Waiting its turn' : 'Starting')
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

const NO_PRIORITY: PriorityOf = () => null
/** A review with no priority comes after every one that has one. */
const placeOfPriority = (row: ReviewRow) => (row.priority ? GRADE_ORDER[row.priority] : GRADE_ORDER.P3 + 1)

const newestFirst = (a: ReviewRow, b: ReviewRow) => momentOf(b) - momentOf(a)
const oldestFirst = (a: ReviewRow, b: ReviewRow) => momentOf(a) - momentOf(b)
const mostPressingFirst = (a: ReviewRow, b: ReviewRow) => placeOfPriority(a) - placeOfPriority(b) || oldestFirst(a, b)

const COMPARE: Record<ReviewOrder, (a: ReviewRow, b: ReviewRow) => number> = {
  priority: mostPressingFirst,
  newest: newestFirst,
  oldest: oldestFirst,
}

/** Every review that ran or runs, newest first. */
export function rowsOf(list: ReviewList | null, priorityOf: PriorityOf = NO_PRIORITY): ReviewRow[] {
  const rows = (list?.reviews ?? []).flatMap((item) => rowOf(item, priorityOf) ?? [])
  return rows.sort(newestFirst)
}

/** The repositories the host keeps a line for: their rows that wait fold under that line, not into Running. */
const linedOf = (list: ReviewList | null) => new Set(readRepoLines(list?.repos).map((line) => line.project))
const foldsUnder = (row: ReviewRow, lined: ReadonlySet<string>) => row.turn != null && row.item.state !== 'ready' && lined.has(row.item.project)

/**
 * Asked to merge first, then running, ready and failed, each in the order picked: newest first when none is. Of the
 * running ones, those under way come before those still waiting, whatever the order. A row that waits its turn in a
 * repository the host keeps a line for is under that line instead (`repoLinesOf`).
 */
export function groupReviews(list: ReviewList | null, { order = 'newest', priorityOf = NO_PRIORITY }: Partial<ReviewOrdering> = {}): ReviewGroups {
  const lined = linedOf(list)
  const rows = rowsOf(list, priorityOf)
    .filter((row) => !foldsUnder(row, lined))
    .sort(COMPARE[order])

  const groups: ReviewGroups = { unmerged: [], running: [], ready: [], failed: [] }
  for (const row of rows) groups[row.group].push(row)

  const underWay = groups.running.filter(({ startedAt }) => startedAt !== null)
  const waiting = groups.running.filter(({ startedAt }) => startedAt === null)
  groups.running = [...underWay, ...waiting]
  return groups
}

export function reviewCounts(groups: ReviewGroups): Record<ReviewGroup, number> {
  return { unmerged: groups.unmerged.length, running: groups.running.length, ready: groups.ready.length, failed: groups.failed.length }
}

/** A repository's line above its rows (spec 058): its counts and this week's cost in words, and its rows that wait. */
export interface RepoLine {
  project: string
  /** "shop: 3 current · 12 waiting · 2 outdated · 9 built this week, about 1.1M tokens" */
  words: string
  /** The rows that wait their turn, the nearest to being built first. */
  waiting: ReviewRow[]
}

/** About how many tokens, in a few characters: 840, 12k, 1.1M. */
function tokenWords(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}k`
  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

/** Each repository's line, as the host sends it, with its rows that wait. None from a host that keeps no line. */
export function repoLinesOf(list: ReviewList | null, priorityOf: PriorityOf = NO_PRIORITY): RepoLine[] {
  const lined = linedOf(list)
  const waiting = rowsOf(list, priorityOf)
    .filter((row) => foldsUnder(row, lined))
    .sort((a, b) => a.turn!.ahead - b.turn!.ahead || oldestFirst(a, b))
  return readRepoLines(list?.repos).map(({ project, current, waiting: waits, outdated, builtThisWeek, tokensThisWeek }) => {
    const cost = tokensThisWeek != null ? `, about ${tokenWords(tokensThisWeek)} tokens` : ''
    return {
      project,
      words: `${project}: ${current} current · ${waits} waiting · ${outdated} outdated · ${builtThisWeek} built this week${cost}`,
      waiting: waiting.filter((row) => row.item.project === project),
    }
  })
}

/** A row that waits its turn can be built now, outside its repository's line, unless it is being built already. */
export function canReviewNow(row: ReviewRow): boolean {
  const built = ['queued', 'running'].includes(row.item.assessment?.state ?? '') || row.item.state === 'preparing'
  return row.turn != null && !built
}

/**
 * What the row's build button is called, and whether it builds at once outside its repository's line (`now`). A review
 * of an older commit says "Rebuild", the word the review's own Outdated notice uses, and does what that notice's button
 * does: it builds the review again at the change's commit. Otherwise a waiting row says "Review now", and any other
 * "Review again".
 */
export function buildButton(row: ReviewRow): { word: 'Rebuild' | 'Review now' | 'Review again'; now: boolean } {
  if (readOutdated(row.item.outdated)) return { word: 'Rebuild', now: false }
  if (canReviewNow(row)) return { word: 'Review now', now: true }
  return { word: 'Review again', now: false }
}

/** Nothing changed since the review: it is ready at the commit the change is at. Review again then costs a whole review for nothing new. */
export function nothingChanged(row: ReviewRow): boolean {
  const { assessment, head, outdated } = row.item
  if (readOutdated(outdated) || assessment?.state !== 'ready') return false
  return assessment.head != null && assessment.head === head
}

/** A review that ran can be run again: one that is ready, or one that stopped. One under way is already being built. */
export const canReviewAgain = (row: ReviewRow) => row.group !== 'running' && !(row.group === 'unmerged' && ['queued', 'running'].includes(row.item.assessment?.state ?? ''))

/** The review a row opens. Without a host a finished change opens the sample review, as its Work card does. */
export function reviewToOpen(item: ReviewListItem, live: boolean): string {
  return live || item.kind === 'pull' ? item.id : 'sample'
}
