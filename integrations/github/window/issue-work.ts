import type { IssueWork } from '../protocol.ts'
import type { FinishedGroupName, WorkState } from '#shared/protocol/work.ts'

/**
 * What an issue on the GitHub page says once hobkin has work filed for it: a chip with what that work waits on, in
 * plain words, and the place on the Work screen where the user can act on it. A chip leads somewhere only when the
 * Work screen shows the item now, and one with nowhere to go never reads as a call to act. Pure, so it is tested
 * without a window. Specs: 011-work, 024-github.
 */

export type ChipTone = 'ok' | 'live' | 'warn' | 'quiet'

export interface IssueChip {
  label: string
  tone: ChipTone
  /** The item on the Work screen, to open it there: its row in the queue, its finished card, or its row among what is merging. Null where Work shows nothing for it. */
  target: string | null
}

/** Where the Work screen shows an item now: in the queue, as a finished card in one of its groups, or among what the user said yes to that is merging. */
export type WorkPlace = { on: 'queue' } | { on: 'card'; group: FinishedGroupName } | { on: 'merging' } | null

/** Where the Work screen shows hobkin's item `slug:item` now, read from the work it draws. Null before it says anything, or where it shows nothing. */
export function placeOnWork(work: WorkState | null, slug: string, item: string): WorkPlace {
  if (!work) return null
  const key = `${slug}:${item}`
  if (work.merging?.some((row) => row.key === key)) return { on: 'merging' }
  const group = work.finished.find(({ changes }) => changes.some((change) => change.key === key))
  if (group) return { on: 'card', group: group.name }
  return work.queue.some((row) => row.key === `item:${key}`) ? { on: 'queue' } : null
}

/** What a finished card waits on, by the group it is in: a note its run left, something that holds it back from one yes, or the user's yes. */
const CARD_WAITS: Record<FinishedGroupName, string> = {
  left: 'Read its note',
  needs: 'Review its change',
  merge: 'Approve its change',
  refresh: 'Approve its change',
}

/** Where an item stands in each state when the Work screen has no card for it. Nothing here is a call to act. */
const STANDINGS: Record<string, { label: string; tone: ChipTone }> = {
  open: { label: 'In queue', tone: 'quiet' },
  // An older record's word for a run that stopped, which runs again like anything open.
  stuck: { label: 'In queue', tone: 'quiet' },
  doing: { label: 'Working', tone: 'live' },
  // Finished on its branch, and no card shows it now: one that lands with another branch, for one.
  branch: { label: 'Finished', tone: 'quiet' },
  pr: { label: 'PR open', tone: 'ok' },
  // A merge is the work done, and hobkin closes the issue as it merges, or, on a project that deploys, once a deploy that carries it held (`MERGED_UNTIL_DEPLOYED`).
  merged: { label: 'Done', tone: 'ok' },
  done: { label: 'Done', tone: 'ok' },
  declined: { label: 'Declined', tone: 'quiet' },
  dropped: { label: 'Dropped', tone: 'quiet' },
}

/**
 * A merge on a project that deploys, by where its deploy stands: its issue stays open on GitHub until a deploy that carries it held, so it
 * reads as waiting for that rather than Done. Merged since the last deploy, or carried by one that regressed, it waits for the next.
 */
const MERGED_UNTIL_DEPLOYED: Record<string, { label: string; tone: ChipTone }> = {
  waiting: { label: 'Merged, waits for deploy', tone: 'quiet' },
  regressed: { label: 'Merged, waits for deploy', tone: 'quiet' },
  deploying: { label: 'Deploying', tone: 'live' },
}

/** Right after Add to queue, before the host says which item hobkin filed. */
export const JUST_ADDED: IssueChip = { label: 'Added to queue', tone: 'ok', target: null }

/** `place`: where the Work screen shows the item now (`placeOnWork`). `justAdded`: the user added it in this window, so while its item waits in the queue the chip says so. */
export function issueChip({ slug, item, state, deploy }: IssueWork, place: WorkPlace, justAdded = false): IssueChip {
  const key = `${slug}:${item}`
  // Work shows no card for what the user said merge to: it left the moment they did.
  if (place?.on === 'merging') return { label: 'Merging after your yes', tone: 'live', target: null }
  if (place?.on === 'card') return { label: CARD_WAITS[place.group], tone: 'warn', target: `[data-change="${key}"]` }
  const target = place?.on === 'queue' ? `[data-queue-row="item:${key}"]` : null
  const untilDeployed = state === 'merged' && deploy ? MERGED_UNTIL_DEPLOYED[deploy] : undefined
  const standing = untilDeployed ?? STANDINGS[state] ?? { label: 'Filed', tone: 'quiet' }
  if (justAdded && (state === 'open' || state === 'stuck')) return { ...JUST_ADDED, target }
  return { ...standing, target }
}
