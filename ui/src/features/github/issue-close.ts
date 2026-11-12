import { createStore } from 'zustand/vanilla'
import type { IssueWork } from '#shared/protocol/github.ts'

/**
 * Close issue on the GitHub page, confirmed in place as a verdict in Review is: the first click arms the button, which waits ten seconds for
 * a second, and the second closes the issue through the host's gh, as the user. Completed is the reason unless the user picks Not planned.
 * Pure, so the timing is tested without a window; `rows.tsx` draws it. Spec: 024-github.
 */

/** Why the issue closes: its work is done, or it will not be done. The host command's words; gh says "not planned". */
export type CloseReason = 'completed' | 'not-planned'

export const CLOSE_REASONS: readonly { value: CloseReason; label: string }[] = [
  { value: 'completed', label: 'Completed' },
  { value: 'not-planned', label: 'Not planned' },
]

/** How long the button waits for its second click, as a verdict in Review waits (`CONFIRM_MS` in `features/review/verdict.ts`). */
export const CLOSE_CONFIRM_MS = 10_000

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

interface CloseState {
  /** The first click came, and the button waits for the second. */
  armed: boolean
  reason: CloseReason
  /** The issue is being closed. */
  busy: boolean
  /** What came of the last close: the host's words, or why it was refused. */
  said: { tone: 'done' | 'refused'; text: string } | null
}

/** One issue's Close issue button. `close` closes it with the reason chosen and answers what was done, or throws why not. */
export function createIssueClose({ close, confirmMs = CLOSE_CONFIRM_MS }: { close: (reason: CloseReason) => Promise<string>; confirmMs?: number }) {
  const store = createStore<CloseState>(() => ({ armed: false, reason: 'completed', busy: false, said: null }))
  let waiting: ReturnType<typeof setTimeout> | undefined
  const wait = () => {
    clearTimeout(waiting)
    waiting = setTimeout(() => store.setState({ armed: false }), confirmMs)
  }
  /** Takes the first click back, as Escape or leaving the button does. */
  const cancel = () => {
    clearTimeout(waiting)
    store.setState({ armed: false })
  }
  /** A click: the first arms it, and a second while it waits closes the issue. A click while it closes does nothing. */
  const press = async (): Promise<void> => {
    const { armed, busy, reason } = store.getState()
    if (busy) return
    if (!armed) {
      store.setState({ armed: true, said: null })
      return wait()
    }
    clearTimeout(waiting)
    store.setState({ armed: false, busy: true })
    try {
      store.setState({ busy: false, said: { tone: 'done', text: await close(reason) } })
    } catch (error) {
      store.setState({ busy: false, said: { tone: 'refused', text: error instanceof Error ? error.message : String(error) } })
    }
  }
  /** The reason the second click closes it with. Choosing another while it waits gives it its ten seconds again. */
  const choose = (reason: CloseReason) => {
    if (reason === store.getState().reason) return
    store.setState({ reason })
    if (store.getState().armed) wait()
  }
  const dispose = () => clearTimeout(waiting)
  return Object.assign(store, { press, choose, cancel, dispose })
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
