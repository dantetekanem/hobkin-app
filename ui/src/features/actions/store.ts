import { useMemo } from 'react'
import { create } from 'zustand'
import { emptyQueue } from '../questions/queue.ts'
import { useQuestions } from '../questions/store.ts'
import { waiting, type ActionItem, type WaitingRow } from './items.ts'
import { sampleItems } from './sample.ts'
import { hostStore } from '../../lib/host/client.ts'
import type { HostState } from '../../lib/host/state.ts'
import { hostRows } from './host.ts'

/** Real rows stay authoritative, including while disconnected. Local question state is sample-only. */
export const useActionItems = create<{ sample: boolean; items: ActionItem[]; rows: WaitingRow[] }>()(() => ({
  sample: true, items: sampleItems, rows: [],
}))

function syncActions(state: HostState, previous?: HostState): void {
  if (previous && state.home === previous.home && state.snapshot.decisions === previous.snapshot.decisions &&
    state.snapshot.waiting === previous.snapshot.waiting && state.epoch === previous.epoch) return
  const sample = state.home === null
  const changedHome = previous !== undefined && state.home !== previous.home
  useActionItems.setState({ sample, rows: sample || changedHome ? [] : hostRows(state.snapshot) })
}

syncActions(hostStore.getState())
const unsubscribe = hostStore.subscribe(syncActions)
import.meta.hot?.dispose(unsubscribe)

/**
 * Everything waiting on the user, as Action Items lists it: hobkin's items, less what was answered on the
 * question sheet, plus the questions put off there. It follows the sheet's queue, so an answer takes its row
 * away and a question put off arrives.
 */
export function useWaitingRows(): WaitingRow[] {
  const { items, sample, rows } = useActionItems()
  // Only these two lists. The rest of the queue changes as its clock runs, and the rows do not depend on it.
  const answered = useQuestions((state) => state.queue.answered)
  const deferred = useQuestions((state) => state.queue.deferred)
  return useMemo(() => sample ? waiting(items, { ...emptyQueue, answered, deferred }) : rows, [sample, rows, items, answered, deferred])
}

/** How many things wait on the user: the number of rows on Action Items, for the menu's count (012 A4). */
export function useActionCount(): number {
  return useWaitingRows().length
}
