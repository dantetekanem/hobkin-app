/**
 * A pull request as the app knows it, whichever integration read it: Change Review prepares reviews of the open ones
 * in the background (spec 053), and Work and the trail show where one stands. GitHub's integration reads them through
 * gh (`integrations/github/`). See _specs/064-integration-drops.
 */

/** Where a pull request's review stands. `waiting`: a review is asked for and none has been given yet. */
export type ReviewState = 'approved' | 'changes-requested' | 'waiting' | 'none'

/** Where a pull request's checks stand, on its last commit. */
export type ChecksState = 'passing' | 'failing' | 'pending' | 'none'

export interface PullRequest {
  /** `owner/name` */
  repo: string
  number: number
  title: string
  labels: string[]
  /** When it last changed on its code host, as an ISO time. */
  updatedAt: string
  url: string
  draft: boolean
  /** Who opened it. Null for an account the code host no longer has. */
  author: string | null
  review: ReviewState
  checks: ChecksState
  /** Lines added and removed, and files changed, as the code host counts them now. A host older than these does not send them. */
  additions?: number
  deletions?: number
  changedFiles?: number
  /**
   * The full commit its branch is at, when it was opened, and when that head commit was committed (about when it was
   * last pushed), as ISO times. A host or a cached list from before these does not send them.
   */
  head?: string
  openedAt?: string
  pushedAt?: string
}
