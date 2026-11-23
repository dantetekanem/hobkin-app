/**
 * What the review header says of a review that is not of its change as it stands: built for an older commit, or built
 * from another start than the change has now, as one built before its start was measured from origin's default branch.
 * While a newer one is being built, it says that instead.
 */
import type { ReviewStatus } from '#shared/review/status.ts'
import type { ReviewChange } from '#shared/review/types.ts'

export interface OutdatedNotice {
  words: string
  /** A newer review is on its way, so there is nothing to ask for. */
  rebuilding: boolean
}

const short = (commit: string) => commit.slice(0, 7)

export function outdatedNotice(built: Pick<ReviewChange, 'base' | 'head'>, now: Pick<ReviewStatus, 'phase' | 'head' | 'startsAt'>): OutdatedNotice | null {
  if (now.phase != null) {
    const forCommit = now.head ? ` for ${short(now.head)}` : ''
    return { rebuilding: true, words: `Building the review again${forCommit}. This one stays open until it is ready.` }
  }

  const moved = now.head != null && now.head !== built.head
  if (moved) {
    return { rebuilding: false, words: `Outdated. Built for ${short(built.head)}, and the change is now at ${short(now.head!)}.` }
  }

  const startsElsewhere = now.startsAt != null && now.startsAt !== built.base
  if (startsElsewhere) {
    return { rebuilding: false, words: `Outdated. Built from ${short(built.base)}, and the change starts at ${short(now.startsAt!)}, so it does not show the change as it is.` }
  }

  return null
}
