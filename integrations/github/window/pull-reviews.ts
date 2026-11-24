import type { GitHubLists, GitHubPull } from '../protocol.ts'
import { reviewIdOf, targetOfReviewId } from '#shared/review/ids.ts'
import type { ReviewRow } from '../../../ui/src/features/work/ai-reviews.ts'

/**
 * The GitHub page's pull requests with their AI reviews (spec 032): the ones that ask for the user's review, the user's
 * own, and the others the AI reviewed, each pull request once. A row's AI review is none yet, running, ready or
 * failed, from the host's list of reviews (`review.list`). Pure, so it is tested without a window.
 */

/** How many of the others reviewed by AI the page lists. Work's AI Reviews tab lists every one. */
export const RECENT_MOST = 8

export type PullAi =
  | { state: 'none' | 'unavailable' }
  | { state: 'running'; percent: number | null; line: string; startedAt: number | null }
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
  if (row.group === 'running') return { state: 'running', percent: row.percent, line: row.line, startedAt: row.startedAt }
  if (row.group === 'failed') return { state: 'failed', line: row.line }
  return { state: 'ready', row }
}

function sizeOf(row: ReviewRow | undefined): PullEntry['size'] {
  const request = row?.item.assessment?.request
  return request ? { added: request.added, removed: request.removed, files: request.files } : null
}

/** GitHub's own count, for the pull request as it is now. A host older than the count does not send it. */
function countedBy({ additions, deletions, changedFiles }: GitHubPull): PullEntry['size'] {
  return additions === undefined || deletions === undefined || changedFiles === undefined ? null : { added: additions, removed: deletions, files: changedFiles }
}

/** The page's three lists. `rows` are every review that ran, newest first, as `rowsOf` gives them; only pull requests' count. */
export function pullSections(lists: Pick<GitHubLists, 'reviews' | 'pulls'>, rows: readonly ReviewRow[], { most = RECENT_MOST, reviewError = null }: { most?: number; reviewError?: string | null } = {}): PullSections {
  const unavailable = reviewError !== null
  const pulls = unavailable ? [] : rows.filter(({ item }) => item.kind === 'pull')
  const byId = new Map(pulls.map((row) => [row.item.id, row]))
  const listed = new Set<string>()

  const entryOf = (pull: GitHubPull): PullEntry => {
    const id = pullReviewId(pull.url)
    const row = id ? byId.get(id) : undefined
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
      return { id: row.item.id, pull: null, ai: aiOf(row), title: row.item.title, repo, number, size: sizeOf(row) }
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
