import { CONFIRM_MS, createTwoClicks } from '../../../ui/src/lib/two-clicks.ts'
import type { IssueWork } from '../protocol.ts'

/**
 * Close issue on the GitHub page, confirmed in place by the core's two clicks: the first click arms the button, which waits ten seconds for
 * a second, and the second closes the issue through the host's gh, as the user. Completed is the reason unless the user picks Not planned.
 * Pure, so the timing is tested without a window; `rows.tsx` draws it. Spec: 024-github.
 */

/** Why the issue closes: its work is done, or it will not be done. The host command's words; gh says "not planned". */
export type CloseReason = 'completed' | 'not-planned'

export const CLOSE_REASONS: readonly { value: CloseReason; label: string }[] = [
  { value: 'completed', label: 'Completed' },
  { value: 'not-planned', label: 'Not planned' },
]

/** How long the button waits for its second click, as every button that asks twice does (`CONFIRM_MS` in `lib/two-clicks.ts`). */
export const CLOSE_CONFIRM_MS = CONFIRM_MS

/** What the action answers with no host, which has nothing to close. */
export const SAMPLE_CLOSE = 'This is sample data, so nothing was closed. With a host, gh closes the issue on GitHub as you.'

/** hobkin's states for work that is over, which closing its issue leaves as it is. */
const OVER = new Set(['merged', 'done', 'declined', 'dropped'])

/** What closing the issue does to hobkin's work for it, for the confirm to say: its item is declined while it is not finished. Null when nothing is filed or the work is over. */
export function closeWarning(work: IssueWork | null | undefined): string | null {
  if (!work || OVER.has(work.state)) return null
  switch (work.state) {
    case 'doing':
      return 'hobkin is working on it now; the run stops and its item will be declined.'
    case 'waiting':
      return "hobkin's item for it waits for you; it will be declined."
    case 'branch':
      return "hobkin's finished work for it waits for your yes; it will be declined, and its branch stays."
    case 'pr':
      return "hobkin's finished work for it waits for your yes; it will be declined, and its branch and PR stay."
    default:
      return "hobkin's item for it is in the queue; it will be declined."
  }
}

/** One issue's Close issue button: the core's two clicks, closing with the reason chosen. `close` answers what was done, or throws why not. */
export function createIssueClose({ close, confirmMs = CLOSE_CONFIRM_MS }: { close: (reason: CloseReason) => Promise<string>; confirmMs?: number }) {
  return createTwoClicks<CloseReason>({ initial: 'completed', run: close, confirmMs })
}

export type IssueClose = ReturnType<typeof createIssueClose>

/** The host's command that closes an issue (`github.issue.close`), answering what was done. */
export type CloseCommand = (args: { repo: string; number: number; reason: CloseReason }) => Promise<{ message: string }>

/** What the second click does: the host closes the issue and says so. With no host there is nothing to close, and it answers that this is sample data. */
export async function closeIssueAs(reason: CloseReason, { live, issue, command }: { live: boolean; issue: { repo: string; number: number }; command: CloseCommand }): Promise<string> {
  if (!live) return SAMPLE_CLOSE
  const { message } = await command({ repo: issue.repo, number: issue.number, reason })
  return message
}
