import type { Grade } from '#shared/protocol/work.ts'
import type { AssessmentSummary } from '#shared/review/assessment.ts'
import { pullOfReview, pullUrl } from '#shared/review/ids.ts'
import { readCarried, readOutdated, readRepoLines, readTurn, shownAsRow, type ReviewList, type ReviewListItem, type ReviewTurn } from '#shared/review/status.ts'
import { needNumbers, type NeedNumbers } from '../review/panel/needs.ts'

/**
 * The AI Reviews tab's data (spec 032): every review the host knows (`review.list`), finished changes and pull
 * requests together, sorted into what is running, what is ready and what failed, each in the order the user picked,
 * newest first unless they picked another. A review that never ran is left out, unless the host says it waits its
 * turn. Pure, so it is tested without a window.
 */

export type { ReviewList, ReviewListItem }

/**
 * What a review is doing, truthfully (_specs/067-review-list-one-list). `reviewing`: its review runs, or its review is
 * being prepared. `waits`: it waits its turn, with how many are ahead when the host says. `failed`: its review stopped.
 * `ready`: a review opens, or none ran and a merge is the only news.
 */
export type RowState = { kind: 'reviewing'; percent: number | null } | { kind: 'waits'; ahead: number | null } | { kind: 'failed' } | { kind: 'ready' }

/**
 * The order of the list's rows. `easiest`: the story's own order (_specs/064-review-story). `priority`: the most
 * pressing work first, and of two that press the same, the one that has waited longest; a review with no priority comes
 * last. `newest` and `oldest` go by when a row last moved; `smallest` by the changed lines, a review with none last.
 */
export type ReviewOrder = 'easiest' | 'priority' | 'newest' | 'oldest' | 'smallest'

export const REVIEW_ORDERS: readonly { value: ReviewOrder; label: string }[] = [
  { value: 'easiest', label: 'Easiest' },
  { value: 'priority', label: 'Priority' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'smallest', label: 'Smallest' },
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
  state: RowState
  /** A merge the user asked for that failed, with the reason given, and when it was asked. Null for any other row. */
  merge: { why: string; at: number | null } | null
  /** The project, or `owner/repo` for a pull request, with the number of the pull request the review has. */
  where: string
  /** The page of the pull request the review has: its own, or the one its finished change opened. Null when it has none. */
  link: string | null
  /** The priority of the work it is of. Null when it has none. */
  priority: Grade | null
  /** What it is doing now, for a reviewing one; why it waits, for one that waits; why it stopped, for a failed one; empty for a ready one. */
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

const PHASES: Record<string, string> = { reading: 'Reading the change', arranging: 'Arranging the story', checking: 'Checking the result' }

const timeOf = (iso: string | null | undefined): number | null => {
  const at = Date.parse(iso ?? '')
  return Number.isFinite(at) ? at : null
}

/**
 * What a review is doing, from what the host sends, or null for one that never ran and waits for nothing.
 * Reviewing beats failed, so a review asked for again after it stopped shows as reviewing. A review of a finished change
 * the host says waits its turn, or one queued behind others, waits: it is not reviewing. A ready review asked for again
 * stays ready on the host, so the older one still opens, and its phase says how the new one is built.
 */
export function stateOf(item: ReviewListItem): RowState | null {
  const assessment = item.assessment?.state
  const waits: RowState = { kind: 'waits', ahead: readTurn(item.turn)?.ahead ?? null }
  if (assessment === 'running') return { kind: 'reviewing', percent: percentOf(item) }
  if (item.phase === 'queued') return waits
  // Any other phase is a review being built, first or again: it is reading, arranging or checking. The change review
  // the host puts behind it says queued until the graph is drawn, which is no wait.
  if (item.phase || item.state === 'preparing') return { kind: 'reviewing', percent: null }
  if (assessment === 'queued' || item.waiting) return waits
  if (item.state === 'failed' || assessment === 'failed') return { kind: 'failed' }
  if (item.state === 'ready' || assessment === 'ready') return { kind: 'ready' }
  return null
}

function percentOf({ assessment }: ReviewListItem): number | null {
  return assessment?.state === 'running' && assessment.percent != null ? Math.min(100, Math.max(0, Math.round(assessment.percent))) : null
}

/** A review that is reviewing or waits its turn: the host's list changes under it, so it is asked for more often. */
export const isActive = (item: ReviewListItem): boolean => {
  const state = shownAsRow(item) ? stateOf(item) : null
  return state?.kind === 'reviewing' || state?.kind === 'waits'
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
  if (!shownAsRow(item)) return null
  // A merge the user asked for that failed has a row whatever its review does; one that waits is not listed (`shownAsRow`).
  const state = stateOf(item) ?? (item.mergeAsked ? ({ kind: 'ready' } as const) : null)
  if (!state) return null
  const { assessment } = item
  const running = assessment?.state === 'running'
  const turn = readTurn(item.turn) ?? null
  const row: ReviewRow = {
    item,
    state,
    merge: item.mergeAsked ? { why: item.mergeAsked.why ?? 'no reason was given.', at: timeOf(item.mergeAsked.at) } : null,
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
  if (state.kind === 'reviewing') {
    row.line = (running ? assessment.now : undefined) ?? (item.phase ? PHASES[item.phase] : undefined) ?? 'Starting'
    row.percent = state.percent
    // The change review's own start, once it runs; before that, the start of the review it is built on.
    row.startedAt = (running ? timeOf(assessment.startedAt) : null) ?? (item.phase ? timeOf(item.startedAt) : null)
  } else if (state.kind === 'waits') {
    row.line = turn?.why ?? 'Waits its turn'
  } else if (state.kind === 'failed') {
    row.line = (assessment?.state === 'failed' ? assessment.error : undefined) ?? item.error ?? 'It stopped before it finished.'
    row.at = timeOf(item.updatedAt)
  } else {
    row.summary = assessment?.state === 'ready' ? (assessment.summary ?? null) : null
    row.at = timeOf(row.summary?.at) ?? timeOf(item.updatedAt)
  }
  if (row.merge) row.at = row.merge.at
  return row
}

/** How far along a row is: reviewing, then waiting its turn, then anything else. */
const runPlace = ({ state }: ReviewRow) => (state.kind === 'reviewing' ? 0 : state.kind === 'waits' ? 1 : 2)

/**
 * One change reviewed more than once, as a pull request's own review and the review of the finished change behind it,
 * shown as `shown`. When another of them is further along, reviewing or waiting its turn, `shown` says so, with that
 * run's line, percent and start, so a review started again on either shows wherever the change is shown.
 */
export function withRunOf(shown: ReviewRow, others: readonly ReviewRow[]): ReviewRow {
  const furthest = others.reduce((best, row) => (runPlace(row) < runPlace(best) ? row : best), shown)
  if (furthest === shown) return shown

  const { state, line, percent, startedAt } = furthest
  return { ...shown, state, line, percent, startedAt }
}

/** When a row last moved: a running one when it started, or when it was asked for while it waits; the rest when they ended. */
const momentOf = (row: ReviewRow) => row.startedAt ?? row.at ?? timeOf(row.item.updatedAt) ?? 0

const NO_PRIORITY: PriorityOf = () => null

const newestFirst = (a: ReviewRow, b: ReviewRow) => momentOf(b) - momentOf(a)

/** Every review that ran or runs, newest first. */
export function rowsOf(list: ReviewList | null, priorityOf: PriorityOf = NO_PRIORITY): ReviewRow[] {
  const rows = (list?.reviews ?? []).flatMap((item) => rowOf(item, priorityOf) ?? [])
  return rows.sort(newestFirst)
}

/** How many rows there are in each state; a merge that failed is counted there only. */
export interface ReviewCounts {
  unmerged: number
  running: number
  waiting: number
  ready: number
  failed: number
}

export function reviewCounts(rows: readonly ReviewRow[]): ReviewCounts {
  const counts: ReviewCounts = { unmerged: 0, running: 0, waiting: 0, ready: 0, failed: 0 }
  for (const row of rows) {
    if (row.merge) counts.unmerged += 1
    else if (row.state.kind === 'reviewing') counts.running += 1
    else if (row.state.kind === 'waits') counts.waiting += 1
    else counts[row.state.kind] += 1
  }
  return counts
}

/** About how many tokens, in a few characters: 840, 12k, 1.1M. */
function tokenWords(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}k`
  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

/**
 * What the host keeps of each repository's line (spec 058), in words, by project: "3 current · 12 waiting · 2 outdated
 * · 9 built this week, about 1.1M tokens". It sits quietly by that project's heading. None from a host that keeps no line.
 */
export function repoWordsOf(list: ReviewList | null): ReadonlyMap<string, string> {
  return new Map(
    readRepoLines(list?.repos).map(({ project, current, waiting, outdated, builtThisWeek, tokensThisWeek }) => {
      const cost = tokensThisWeek != null ? `, about ${tokenWords(tokensThisWeek)} tokens` : ''
      return [project, `${current} current · ${waiting} waiting · ${outdated} outdated · ${builtThisWeek} built this week${cost}`] as const
    }),
  )
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
export const canReviewAgain = (row: ReviewRow) => row.state.kind === 'ready' || row.state.kind === 'failed'

/** The review a row opens. Without a host a finished change opens the sample review, as its Work card does. */
export function reviewToOpen(item: ReviewListItem, live: boolean): string {
  return live || item.kind === 'pull' ? item.id : 'sample'
}
