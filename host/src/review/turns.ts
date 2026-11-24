/**
 * The line of each repository's reviews (spec 058): which finished changes the background keeps reviewed at the commit
 * they are at, and, for each other one, how many are ahead of it and why it waits. A repository keeps a few current,
 * three unless the workload says otherwise, and never more. The line is Work's order with P0 work first; of its places,
 * at most one goes to the change that has waited longest past two days since it finished and has no review at its
 * commit; once that review is built the place passes to the next, so each is reviewed once in time, one at a time, and
 * a home full of old changes still builds only its few. A change that conflicts, is being brought up to date to merge, or
 * that an agent works on again is not in the line, and says why. What the user asks for is not in here at all: it is
 * always built, and pushes nothing out. Pure, and worked out again from what is there on every look, so a host that
 * reloads its code loses nothing.
 */
import type { Grade } from '#shared/protocol/work.ts'
import type { ReviewTurn } from '#shared/review/status.ts'

/** A finished change as the line weighs it. The background hands them in Work's order. */
export interface LineChange {
  /** Its review id. */
  id: string
  /** Its repository: the project's slug. */
  repo: string
  /** The project's name, for the words. */
  name: string
  grade?: Grade | null
  conflict?: boolean | null
  /** It is being brought up to date to merge, on the user's yes. */
  refreshing?: boolean
  /** An agent works on it again. */
  atWork?: boolean
  /** When it finished, as an ISO time: its clock for the longest wait. */
  at?: string
  /** It has a review at the commit it is at, so the place for the longest wait passes on. */
  reviewed?: boolean
}

export interface Line {
  /** The changes whose reviews the background keeps current. */
  current: Set<string>
  /** Every other change, with how many are ahead of it in its repository's line and why it waits. */
  waits: Map<string, ReviewTurn>
}

/** How many reviews a repository keeps current unless the workload says otherwise. */
export const KEPT_CURRENT = 3
/** How long a change waits before it is taken next. */
export const LONGEST_WAIT_MS = 48 * 60 * 60 * 1000

/** Why a change is not in the line at all, or null when it is. */
function outOfLine(change: LineChange): string | null {
  if (change.atWork) return 'An agent is working on it again, so its review waits until it finishes.'
  if (change.conflict) return 'It conflicts with its base, so its review waits for the rebase.'
  if (change.refreshing) return 'It is being brought up to date to merge, so it is not reviewed again now.'
  return null
}

/** Whether a change has waited long enough to be taken next. */
function waitedTooLong(change: LineChange, now: number): boolean {
  const since = Date.parse(change.at ?? '')
  return Number.isFinite(since) && now - since >= LONGEST_WAIT_MS
}

/** The line of every repository the changes are in. `keep` is how many each keeps current, a whole number from 1. */
export function lineOf(changes: readonly LineChange[], { keep = KEPT_CURRENT, now }: { keep?: number; now: number }): Line {
  const kept = Number.isInteger(keep) && keep >= 1 ? keep : KEPT_CURRENT
  const current = new Set<string>()
  const waits = new Map<string, ReviewTurn>()
  const repos = new Map<string, LineChange[]>()
  for (const change of changes) repos.set(change.repo, [...(repos.get(change.repo) ?? []), change])

  for (const inRepo of repos.values()) {
    const inLine: LineChange[] = []
    for (const change of inRepo) {
      const why = outOfLine(change)
      if (why) waits.set(change.id, { ahead: 0, why })
      else inLine.push(change)
    }
    const urgent = inLine.filter((change) => change.grade === 'P0')
    // The one that waited longest past two days with no review at its commit takes one place; the rest follow Work's order.
    const longest = inLine
      .filter((change) => change.grade !== 'P0' && !change.reviewed && waitedTooLong(change, now))
      .reduce<LineChange | undefined>((oldest, change) => (!oldest || Date.parse(change.at!) < Date.parse(oldest.at!) ? change : oldest), undefined)
    const rest = inLine.filter((change) => !urgent.includes(change) && change !== longest)
    const ordered = [...urgent, ...(longest ? [longest] : []), ...rest]
    ordered.forEach((change, ahead) => {
      if (ahead < kept) current.add(change.id)
      else waits.set(change.id, { ahead, why: `Waits its turn: ${ahead} ahead in ${change.name}.` })
    })
  }
  return { current, waits }
}
