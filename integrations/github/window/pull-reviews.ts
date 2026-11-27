import type { GitHubLists, GitHubPull } from '../protocol.ts'
import { reviewIdOf, targetOfReviewId } from '#shared/review/ids.ts'
import { withRunOf, type ReviewRow } from '../../../ui/src/features/work/ai-reviews.ts'

/**
 * The GitHub page's pull requests with their AI reviews (spec 032): the ones that ask for the user's review, the user's
 * own, and the others the AI reviewed, each pull request once. A row's AI review is none yet, running, waiting its
 * turn, ready or failed, from the state each review row says (`review.list`, read by `rowsOf`). Pure, so it is tested
 * without a window.
 */

/** How many of the others reviewed by AI the page lists. Work's AI Reviews tab lists every one. */
export const RECENT_MOST = 8

export type PullAi =
  | { state: 'none' | 'unavailable' }
  | { state: 'running'; percent: number | null; line: string; startedAt: number | null }
  /** It waits its turn, with how many are ahead when the host says: it is not running yet. */
  | { state: 'waits'; ahead: number | null }
  | { state: 'ready'; row: ReviewRow }
  | { state: 'failed'; line: string }

export interface PullEntry {
  /** The pull request's review, by name. Null for a page that names no pull request. */
  id: string | null
  /** As GitHub lists it. Null for one the AI reviewed that is in neither of GitHub's lists, merged since or opened from a link. */
  pull: GitHubPull | null
  ai: PullAi
  title: string
  /** `owner/repo` */
  repo: string
  number: number | null
  /** Lines added and removed, and files: GitHub's count for one GitHub lists, else what its AI review read. Null while neither has said. */
  size: { added: number; removed: number; files: number } | null
}

export interface PullSections {
  /** Waiting for the user's review, in GitHub's order. */
  requested: PullEntry[]
  /** The user's own, in GitHub's order, less any already asked of them. */
  mine: PullEntry[]
  /** The others the AI reviewed, newest first. */
  reviewed: PullEntry[]
}

/** The review a pull request's page names, however the page writes its case. Null for any other page. */
export function pullReviewId(url: string): string | null {
  const target = targetOfReviewId(url)
  return target?.kind === 'pull' ? reviewIdOf(target) : null
}

export function aiOf(row: ReviewRow | undefined): PullAi {
  if (!row) return { state: 'none' }
  // A merge the user asked for comes after a finished review, whatever the row's review does now.
  if (row.merge) return { state: 'ready', row }
  switch (row.state.kind) {
    case 'reviewing':
      return { state: 'running', percent: row.percent, line: row.line, startedAt: row.startedAt }
    case 'waits':
      return { state: 'waits', ahead: row.state.ahead }
    case 'failed':
      return { state: 'failed', line: row.line }
    case 'ready':
      return { state: 'ready', row }
  }
}

function sizeOf(row: ReviewRow | undefined): PullEntry['size'] {
  const request = row?.item.assessment?.request
  return request ? { added: request.added, removed: request.removed, files: request.files } : null
}

/** GitHub's own count, for the pull request as it is now. A host older than the count does not send it. */
function countedBy({ additions, deletions, changedFiles }: GitHubPull): PullEntry['size'] {
  return additions === undefined || deletions === undefined || changedFiles === undefined ? null : { added: additions, removed: deletions, files: changedFiles }
}

/**
 * Each pull request's review, by name, as the page shows it: its own, or else the review of the finished change that
 * opened it, which the host lists in its place. A finished change at the same commit is the same change, so a review of
 * it that runs or waits shows on the pull request too, and so does one of the change that opened it.
 */
function reviewsOfPulls(rows: readonly ReviewRow[]): (id: string) => ReviewRow | undefined {
  const own = new Map<string, ReviewRow>()
  const opened = new Map<string, ReviewRow>()
  const changesAt = new Map<string, ReviewRow[]>()
  for (const row of rows) {
    const { head } = row.item
    if (row.item.kind === 'pull') {
      own.set(row.item.id, row)
    } else {
      const pull = row.link ? pullReviewId(row.link) : null
      if (pull) opened.set(pull, row)
      if (head) changesAt.set(head, [...(changesAt.get(head) ?? []), row])
    }
  }

  return (id) => {
    const shown = own.get(id) ?? opened.get(id)
    if (!shown) return undefined

    const atItsCommit = shown.item.head ? (changesAt.get(shown.item.head) ?? []) : []
    const sameChange = [opened.get(id), ...atItsCommit].filter((row): row is ReviewRow => row !== undefined && row !== shown)
    return withRunOf(shown, sameChange)
  }
}

/** A review of a pull request on github.com. One on a code host the home names, such as GitLab or the user's own, is not GitHub's. */
function onGitHub({ item }: ReviewRow): boolean {
  const target = item.kind === 'pull' ? targetOfReviewId(item.id) : null
  return target?.kind === 'pull' && !target.host
}

/**
 * The page's three lists. `rows` are every review that ran, newest first, as `rowsOf` gives them. The others reviewed are
 * only github.com's: a pull request on another code host opens as a review from Work, never from here.
 */
export function pullSections(lists: Pick<GitHubLists, 'reviews' | 'pulls'>, rows: readonly ReviewRow[], { most = RECENT_MOST, reviewError = null }: { most?: number; reviewError?: string | null } = {}): PullSections {
  const unavailable = reviewError !== null
  const pulls = unavailable ? [] : rows.filter(onGitHub)
  const reviewOf = reviewsOfPulls(unavailable ? [] : rows)
  const listed = new Set<string>()

  const entryOf = (pull: GitHubPull): PullEntry => {
    const id = pullReviewId(pull.url)
    const row = id ? reviewOf(id) : undefined
    if (id) listed.add(id)
    return { id, pull, ai: unavailable ? { state: 'unavailable' } : aiOf(row), title: pull.title, repo: pull.repo, number: pull.number, size: countedBy(pull) ?? sizeOf(row) }
  }
  const unlisted = (pull: GitHubPull) => {
    const id = pullReviewId(pull.url)
    return !id || !listed.has(id)
  }

  const requested = lists.reviews.map(entryOf)
  const mine = lists.pulls.filter(unlisted).map(entryOf)
  const reviewed = pulls
    .filter(({ item }) => !listed.has(item.id))
    .slice(0, most)
    .map((row): PullEntry => {
      const target = targetOfReviewId(row.item.id)
      const number = target?.kind === 'pull' ? target.number : null
      const repo = row.item.project || (target?.kind === 'pull' ? `${target.owner}/${target.repo}` : '')
      return { id: row.item.id, pull: null, ai: aiOf(reviewOf(row.item.id)), title: row.item.title, repo, number, size: sizeOf(row) }
    })
  return { requested, mine, reviewed }
}

/**
 * "Start AI review": asks the host to prepare the pull request's review, which starts its AI review, and then opens it,
 * where it shows how it goes. Without a host it only opens the review. A refusal opens nothing and comes back as why.
 */
export async function startAiReview(id: string, { live, prepare, open }: { live: boolean; prepare: (id: string) => Promise<unknown>; open: (id: string) => void }): Promise<string | null> {
  if (live) {
    try {
      await prepare(id)
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }
  open(id)
  return null
}
