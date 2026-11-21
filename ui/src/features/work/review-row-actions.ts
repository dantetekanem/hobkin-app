import { createStore } from 'zustand/vanilla'
import type { CommandArgs, CommandResults } from '#shared/commands/registry.ts'
import { CONFIRM_MS, createVerdictChoices } from '../review/verdict.ts'
import { canReviewAgain, type ReviewRow } from './ai-reviews.ts'

/**
 * The actions on a row of the AI Reviews tab (spec 032), shown on the row: Remove and Remove and delete branch, the
 * review's own two noes (`discard` and `discard-branch`), done from the row without opening it. A row with no no to give
 * has a plain Remove (`remove`), which takes the review out of the list and nothing else. Each is asked in place: the
 * first click says what it will do, a second within ten seconds does it, and after that it goes back. Only one waits at
 * a time. Pure, so it is tested without a window.
 */

export type RowAction = 'remove' | 'discard' | 'discard-branch'

type RowCommand = 'review.preview' | 'review.verdict' | 'review.remove'
export type RowCommands = <Name extends RowCommand>(name: Name, args: CommandArgs<Name>) => Promise<CommandResults[Name]>

/**
 * What a row offers, in the order it shows them. A finished change, and a pull request its review recorded as the
 * user's own, are removed with the no: hobkin's no (which stops a merge waiting after its refresh) or the pull request
 * closed, and the review leaves the list. Someone else's pull request is closed by its author, and a review that was
 * never built has nothing to say no from: those get the plain Remove, once nothing of them is being built.
 */
export function rowActions(row: ReviewRow): RowAction[] {
  const { kind, owner, state, assessment } = row.item
  const built = !(state === 'failed' && !assessment)
  if ((kind === 'change' || owner?.mine) && built) return ['discard', 'discard-branch']
  return canReviewAgain(row) ? ['remove'] : []
}

/** Each action's name on the row. The plain Remove and the no share one, since both take the row off the list. */
export const ACTION_LABEL: Record<RowAction, string> = { remove: 'Remove', discard: 'Remove', 'discard-branch': 'Remove and delete branch' }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Remove, asked in place. The host only takes the review out of the list: the change, its branch and its pull request stay. */
function createRemoval({ id, command, removed }: { id: string; command: RowCommands; removed: () => void }) {
  const store = createStore<{ armed: boolean; busy: boolean; error: string | null }>(() => ({ armed: false, busy: false, error: null }))
  let waiting: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    clearTimeout(waiting)
    if (store.getState().armed) store.setState({ armed: false })
  }
  const press = async () => {
    const { armed, busy } = store.getState()
    if (busy) return
    clearTimeout(waiting)
    if (!armed) {
      store.setState({ armed: true, error: null })
      waiting = setTimeout(cancel, CONFIRM_MS)
      return
    }
    store.setState({ armed: false, busy: true })
    try {
      await command('review.remove', { id })
      removed()
    } catch (error) {
      store.setState({ error: messageOf(error) })
    } finally {
      store.setState({ busy: false })
    }
  }
  return Object.assign(store, { press, cancel })
}

/**
 * A row's actions. `head` is the commit the list knows the review at, or null when it knows none. `changed` hears that
 * the host did one, so the list is read again and the row leaves it.
 */
export function createRowActions({ id, head, command, changed }: { id: string; head: string | null; command: RowCommands; changed: () => void }) {
  const removal = createRemoval({ id, command, removed: changed })
  // The same verdict flow as the review panel's: nothing to save from here, and no comment goes with a no.
  const verdicts = createVerdictChoices({ id, head, command, saveNotes: async () => {}, current: () => true, landed: () => changed() })
  const press = async (action: RowAction): Promise<void> => {
    if (action === 'remove') {
      verdicts.cancel()
      return removal.press()
    }
    removal.cancel()
    return verdicts.press(action)
  }
  /** The action waiting for its second click, if one is. */
  const armed = (): RowAction | null => (removal.getState().armed ? 'remove' : ((verdicts.armed() as RowAction | null) ?? null))
  const cancel = () => {
    removal.cancel()
    verdicts.cancel()
  }
  const connect = () => {
    const disconnect = verdicts.connect()
    return () => {
      removal.cancel()
      disconnect()
    }
  }
  return { removal, verdicts, press, armed, cancel, connect }
}
