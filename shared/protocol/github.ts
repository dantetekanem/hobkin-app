/**
 * The user's GitHub, as the host reads it through gh, GitHub's command line tool, with the login gh already has.
 * The host only reads. No type here has room for a token: gh keeps its own, and the host never asks for it.
 * See _specs/024-github.
 */

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

/** Where a pull request's review stands. `waiting`: a review is asked for and none has been given yet. */
export type ReviewState = 'approved' | 'changes-requested' | 'waiting' | 'none'

/** Where a pull request's checks stand, on its last commit. */
export type ChecksState = 'passing' | 'failing' | 'pending' | 'none'

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
}

export interface GitHubPull {
  /** `owner/name` */
  repo: string
  number: number
  title: string
  labels: string[]
  /** When it last changed on GitHub, as an ISO time. */
  updatedAt: string
  url: string
  draft: boolean
  /** Who opened it. Null for an account GitHub no longer has. */
  author: string | null
  review: ReviewState
  checks: ChecksState
}

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

  const arriving = round % 2 === 1 ? [pull('api', 1194, 'Log the request id with every error', 1, { author: 'mira', review: 'waiting', checks: 'pending' })] : []
  return {
    connection: 'connected',
    login: SAMPLE_GITHUB_LOGIN,
    reviews: [
      ...arriving,
      pull('storefront', 482, 'Keep the cart total between page loads', 25, { author: 'mira', labels: ['performance'], review: 'waiting', checks: 'passing' }),
      pull('api', 1190, 'Retry webhook deliveries with a backoff', 190, { author: 'devon', review: 'waiting', checks: 'pending' }),
      pull('docs', 77, 'Explain the new sign-in steps', 1500, { author: 'sam', labels: ['docs'], review: 'waiting', checks: 'none' }),
    ],
    pulls: [
      pull('storefront', 479, 'Fix the login redirect after a password reset', 120, { labels: ['bug'], review: 'approved', checks: 'passing' }),
      pull('api', 1185, 'Move rate limits into the gateway', 310, { review: 'changes-requested', checks: 'failing' }),
      pull('storefront', 470, 'Try a lighter product grid', 2900, { labels: ['experiment'], draft: true, checks: 'pending' }),
      pull('docs', 71, 'Document the export command', 5800, { review: 'waiting', checks: 'passing' }),
    ],
    issues: [
      issue('storefront', 468, 'The checkout button stays disabled in Safari', 40, { labels: ['bug', 'checkout'], assigned: true }),
      issue('api', 1172, 'Rate limit headers are missing from 429 answers', 1450, { labels: ['bug'], assigned: true, authored: true }),
      issue('docs', 64, 'The quick start skips the install step', 4300, { labels: ['docs'], authored: true }),
      issue('storefront', 455, 'Receipts ignore the dark theme', 13000, { labels: ['enhancement'], authored: true }),
    ],
    more: { reviews: false, pulls: false, issues: false },
    refreshedAt: new Date(now).toISOString(),
    refreshing: false,
    error: null,
    sample: true,
  }
}
