import type { IssueWork } from '#shared/protocol/github.ts'

/**
 * What an issue on the GitHub page says once hobkin has work filed for it: a chip with where its item stands, in
 * plain words, and the place on the Work screen that shows that item, when Work shows one. Pure, so it is tested
 * without a window. Specs: 011-work, 024-github.
 */

export type ChipTone = 'ok' | 'live' | 'warn' | 'quiet'

export interface IssueChip {
  label: string
  tone: ChipTone
  /** The item on the Work screen, to open it there: its row in the queue, or its finished card. Null where Work shows no place for it. */
  target: string | null
}

/** Where Work shows an item in each state: the queue lists what waits to run, and a finished card what waits on the user's yes. */
const STANDINGS: Record<string, { label: string; tone: ChipTone; shown?: 'queue' | 'card' }> = {
  open: { label: 'In queue', tone: 'quiet', shown: 'queue' },
  // An older record's word for a run that stopped, which runs again like anything open.
  stuck: { label: 'In queue', tone: 'quiet', shown: 'queue' },
  doing: { label: 'Working', tone: 'live' },
  waiting: { label: 'Waiting for you', tone: 'warn' },
  branch: { label: 'Waiting for you', tone: 'warn', shown: 'card' },
  pr: { label: 'PR open', tone: 'ok', shown: 'card' },
  merged: { label: 'Merged', tone: 'ok' },
  done: { label: 'Done', tone: 'ok' },
  declined: { label: 'Declined', tone: 'quiet' },
  dropped: { label: 'Dropped', tone: 'quiet' },
}

/** Right after Add to queue, before the host says which item hobkin filed. */
export const JUST_ADDED: IssueChip = { label: 'Added to queue', tone: 'ok', target: null }

/** `justAdded`: the user added it in this window, so while its item waits in the queue the chip says so. */
export function issueChip({ slug, item, state }: IssueWork, justAdded = false): IssueChip {
  const standing = STANDINGS[state] ?? { label: 'Filed', tone: 'quiet' }
  const target =
    standing.shown === 'queue' ? `[data-queue-row="item:${slug}:${item}"]` : standing.shown === 'card' ? `[data-change="${slug}:${item}"]` : null
  if (justAdded && standing.shown === 'queue') return { ...JUST_ADDED, target }
  return { label: standing.label, tone: standing.tone, target }
}
