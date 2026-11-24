/**
 * What the review header says of a review that is not of its change as it stands: built for an older commit, or built
 * from another start than the change has now, as one built before its start was measured from origin's default branch.
 * While a newer one is being built, it says that instead.
 */
import { readCarried, type ReviewStatus } from '#shared/review/status.ts'
import type { ReviewChange } from '#shared/review/types.ts'

export interface OutdatedNotice {
  words: string
  /** A newer review is on its way, so there is nothing to ask for. */
  rebuilding: boolean
}

const short = (commit: string) => commit.slice(0, 7)

/**
 * What the header says of a review carried to the commit it shows (spec 058): from which commit, that its tests ran at
 * this one, and that it was built from that one; with the host's reason it still holds. Null for one built where it is,
 * and for what a host sent that does not read as a carry.
 */
export function carriedLine(carried: unknown): { words: string; why: string } | null {
  const read = readCarried(carried)
  if (!read) return null
  return { words: `Carried from ${short(read.from)}: its tests ran at this commit, and it was built from that one.`, why: read.why }
}

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
