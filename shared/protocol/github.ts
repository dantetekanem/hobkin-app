/**
 * The user's GitHub, as the host reads it through gh, GitHub's command line tool, with the login gh already has.
 * The host only reads. No type here has room for a token: gh keeps its own, and the host never asks for it.
 * See _specs/024-github.
 */

import type { PullRequest } from './pulls.ts'

export type { ChecksState, PullRequest, ReviewState } from './pulls.ts'

/** Whether the host reaches GitHub through gh. */
export type GitHubConnection =
  /** Not known yet: the first look is under way, or it failed before gh could say. */
  | 'unknown'
  /** gh is not installed, or not where the host looks for it. */
  | 'missing'
  /** gh is installed and not signed in to github.com. */
  | 'signed-out'
  /** gh is signed in to github.com. */
  | 'connected'

export interface GitHubIssue {
  /** `owner/name` */
  repo: string
  number: number
  title: string
  labels: string[]
  /** When it last changed on GitHub, as an ISO time. */
  updatedAt: string
  url: string
  /** It is assigned to the user. */
  assigned: boolean
  /** The user opened it. */
  authored: boolean
  /** The hobkin work filed for it, read from hobkin's items. Null when none is. A host older than this does not send it. */
  work?: IssueWork | null
}

/** The hobkin item filed for an issue (its key is `gh-issue:<owner>/<repo>#<n>`), and where it stands. */
export interface IssueWork {
  /** Its project, by hobkin's slug and its name. */
  slug: string
  project: string
  /** The item's id in hobkin. */
  item: string
  /** The item's state in hobkin: `open`, `doing`, `waiting`, `branch`, `pr`, `merged`, `done`, `declined`, `dropped`. */
  state: string
  /** Its pull request's address, once it has one. */
  pr: string | null
}

/** A pull request on GitHub. The app's own shape for one, whichever integration read it. */
export type GitHubPull = PullRequest

/** What one read brings back, each list the most recently updated first. */
export interface GitHubLists {
  /** Open pull requests that wait for the user's review. */
  reviews: GitHubPull[]
  /** The user's own open pull requests. */
  pulls: GitHubPull[]
  /** Open issues assigned to the user or opened by them. */
  issues: GitHubIssue[]
  /** GitHub found more than it sent for that list. The list then holds the most recently updated. */
  more: { reviews: boolean; pulls: boolean; issues: boolean }
}

export interface GitHubState extends GitHubLists {
  connection: GitHubConnection
  /** The account gh is signed in as. Null until connected. */
  login: string | null
  /** When the host last heard from gh, as an ISO time: the lists, or that gh is missing or signed out. A read that failed leaves it as it was. */
  refreshedAt: string | null
  /** A read is under way. */
  refreshing: boolean
  /** What went wrong with the last read, in plain words. What was read before stays. */
  error: string | null
  /** Made-up data, from the scripted host or for a window with no host. Nothing in it came from GitHub. */
  sample: boolean
}

/** How many of each list one read asks GitHub for. */
export const GITHUB_LIMIT = 50

export const NO_GITHUB_LISTS: GitHubLists = { reviews: [], pulls: [], issues: [], more: { reviews: false, pulls: false, issues: false } }

/** Before the host has said anything about GitHub. */
export const GITHUB_UNKNOWN: GitHubState = { connection: 'unknown', login: null, ...NO_GITHUB_LISTS, refreshedAt: null, refreshing: false, error: null, sample: false }

/** The account the sample is signed in as. Plainly not a real one. */
export const SAMPLE_GITHUB_LOGIN = 'sample-user'

/**
 * Made-up data, so the GitHub page can be seen without reaching GitHub: by the scripted host, and by a window
 * with no host. Times count back from `now`. Every second read (`round` odd) brings one more review request,
 * so a refresh shows a row arriving and leaving.
 */
export function sampleGitHub(now: number, round = 0): GitHubState {
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString()
  const at = (repo: string, kind: 'pull' | 'issues', number: number) => `https://github.com/hobkin-sample/${repo}/${kind}/${number}`
  const pull = (repo: string, number: number, title: string, minutes: number, rest: Partial<GitHubPull>): GitHubPull => ({
    repo: `hobkin-sample/${repo}`,
    number,
    title,
    labels: [],
    updatedAt: ago(minutes),
    url: at(repo, 'pull', number),
    draft: false,
    author: SAMPLE_GITHUB_LOGIN,
    review: 'none',
    checks: 'none',
    ...rest,
  })
  const issue = (repo: string, number: number, title: string, minutes: number, rest: Partial<GitHubIssue>): GitHubIssue => ({
    repo: `hobkin-sample/${repo}`,
    number,
    title,
    labels: [],
    updatedAt: ago(minutes),
    url: at(repo, 'issues', number),
    assigned: false,
    authored: false,
    ...rest,
  })

  /** Lines added and removed, and files, as GitHub counts them. The ones an AI review read say the same. */
  const size = (additions: number, deletions: number, changedFiles: number) => ({ additions, deletions, changedFiles })
  /** The hobkin item filed for an issue. Where the Work sample has the item, the ids are its own, so the issue opens its queue row or card. */
  const filed = (slug: string, item: string, state: string, pr: string | null = null): { work: IssueWork } => ({ work: { slug, project: slug, item, state, pr } })

  const arriving = round % 2 === 1 ? [pull('api', 1194, 'Log the request id with every error', 1, { author: 'mira', review: 'waiting', checks: 'pending', ...size(22, 3, 2) })] : []
  return {
    connection: 'connected',
    login: SAMPLE_GITHUB_LOGIN,
    reviews: [
      ...arriving,
      pull('storefront', 482, 'Keep the cart total between page loads', 25, { author: 'mira', labels: ['performance'], review: 'waiting', checks: 'passing', ...size(120, 14, 6) }),
      pull('api', 1190, 'Retry webhook deliveries with a backoff', 190, { author: 'devon', review: 'waiting', checks: 'pending', ...size(86, 31, 4) }),
      pull('docs', 77, 'Explain the new sign-in steps', 1500, { author: 'sam', labels: ['docs'], review: 'waiting', checks: 'none', ...size(48, 6, 2) }),
    ],
    pulls: [
      pull('storefront', 479, 'Fix the login redirect after a password reset', 120, { labels: ['bug'], review: 'approved', checks: 'passing', ...size(18, 4, 2) }),
      pull('api', 1185, 'Move rate limits into the gateway', 310, { review: 'changes-requested', checks: 'failing', ...size(310, 120, 9) }),
      pull('storefront', 470, 'Try a lighter product grid', 2900, { labels: ['experiment'], draft: true, checks: 'pending', ...size(240, 198, 11) }),
      pull('docs', 71, 'Document the export command', 5800, { review: 'waiting', checks: 'passing', ...size(140, 0, 3) }),
    ],
    // One issue for each place hobkin's work on it can stand, and one with nothing filed, which offers Add to queue.
    issues: [
      issue('storefront', 468, 'The checkout button stays disabled in Safari', 40, { labels: ['bug', 'checkout'], assigned: true, ...filed('storefront', 'b8d1f0', 'doing') }),
      issue('storefront', 476, 'The login redirect forgets the page you were on', 95, { labels: ['bug'], authored: true, ...filed('storefront', '8d2f60', 'pr', at('storefront', 'pull', 479)) }),
      // Its run left the user a note, so its card is under Left for you.
      issue('storefront', 463, 'A guest loses their cart on signing in', 300, { labels: ['bug', 'checkout'], assigned: true, ...filed('storefront', 'f41c07', 'branch') }),
      issue('api', 1168, 'Webhook deliveries are retried forever', 600, { labels: ['bug'], assigned: true, ...filed('billing-api', '5e7c21', 'branch') }),
      issue('api', 1172, 'Rate limit headers are missing from 429 answers', 1450, { labels: ['bug'], assigned: true, authored: true, ...filed('billing-api', 'c41a77', 'merged') }),
      issue('docs', 64, 'The quick start skips the install step', 4300, { labels: ['docs'], authored: true, ...filed('docs-site', '52d0f8', 'open') }),
      issue('docs', 58, 'The export command has no page of its own', 5200, { labels: ['docs'], authored: true, ...filed('docs-site', 'd0c5e1', 'done') }),
      issue('storefront', 455, 'Receipts ignore the dark theme', 13000, { labels: ['enhancement'], authored: true, work: null }),
      issue('storefront', 431, 'Add a carousel to the home page', 21000, { labels: ['enhancement'], authored: true, ...filed('storefront', '3b7e90', 'declined') }),
    ],
    more: { reviews: false, pulls: false, issues: false },
    refreshedAt: new Date(now).toISOString(),
    refreshing: false,
    error: null,
    sample: true,
  }
}
