import { useMemo } from 'react'
import { create } from 'zustand'
import { emptyQueue, type Answer, type QuestionQueue } from '../questions/queue.ts'
import { useQuestions } from '../questions/store.ts'
import { waiting, type ActionItem, type WaitingRow } from './items.ts'
import { sampleItems } from './sample.ts'
import { hostStore } from '../../lib/host/client.ts'
import type { HostState } from '../../lib/host/state.ts'
import { hostRows } from './host.ts'

/**
 * Real rows stay authoritative, including while disconnected. Local question state is sample-only. `answering` holds
 * the rows whose answer is on its way to hobkin: they leave the list at once, and come back if hobkin refuses.
 * `answeredHere` holds sample answers, which never leave this window.
 */
export const useActionItems = create<{ sample: boolean; items: ActionItem[]; rows: WaitingRow[]; answering: string[]; answeredHere: QuestionQueue['answered'] }>()(() => ({
  sample: true, items: sampleItems, rows: [], answering: [], answeredHere: [],
}))

/** A sample answered on this screen. It leaves the sample list, and nothing is sent. */
export function answerSample(id: string, answer: Answer): void {
  if (useActionItems.getState().sample) useActionItems.setState(({ answeredHere }) => ({ answeredHere: [...answeredHere, { id, answer }] }))
}

/** An answer went to hobkin: its row leaves until hobkin's own list says otherwise. */
export function startAnswering(id: string): void {
  const { answering } = useActionItems.getState()
  if (!answering.includes(id)) useActionItems.setState({ answering: [...answering, id] })
}

/** hobkin replied. Its next snapshot, which comes first, says whether the item is still open. */
export function stopAnswering(id: string): void {
  useActionItems.setState({ answering: useActionItems.getState().answering.filter((entry) => entry !== id) })
}

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
  const { items, sample, rows, answering, answeredHere } = useActionItems()
  // Only these two lists. The rest of the queue changes as its clock runs, and the rows do not depend on it.
  const answered = useQuestions((state) => state.queue.answered)
  const deferred = useQuestions((state) => state.queue.deferred)
  return useMemo(
    () => (sample ? waiting(items, { ...emptyQueue, answered: [...answered, ...answeredHere], deferred }) : rows.filter(({ id }) => !answering.includes(id))),
    [sample, rows, items, answered, deferred, answering, answeredHere],
  )
}

/** How many things wait on the user: the number of rows on Action Items, for the menu's count (012 A4). */
export function useActionCount(): number {
  return useWaitingRows().length
}
