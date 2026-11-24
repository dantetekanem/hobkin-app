import { useState } from 'react'
import { useWorkUi, runWork } from './store.ts'
import type { Leaving } from '@/features/reports/list-motion.ts'
import type { FinishedChange } from '@/lib/host/index.ts'
import type { HobkinChoice } from './actions.ts'
import { SAMPLE_REVIEW_AGAIN } from './change-controls.tsx'

/**
 * What a finished change's row can do besides open: carry out one of hobkin's choices for it, and run its change
 * review again. A row, its "⋯" menu and a stack's layer line share it. `onDone` runs when a choice was carried out.
 */
export function useChangeActions({ change, live, onLeaving, again, onDone }: { change: FinishedChange; live: boolean; onLeaving: (leaving: Leaving) => void; again: () => Promise<void>; onDone?: () => void }) {
  const busy = useWorkUi((state) => Boolean(state.busy[change.key]))
  const [chosen, setChosen] = useState<HobkinChoice | null>(null)

  const choose = async (choice: Exclude<HobkinChoice, 'review'>, note?: string) => {
    setChosen(choice)
    // What merges goes on to the right; what is set aside, said no to or closed unmerged, goes to the left.
    onLeaving(choice === 'decline' || choice === 'done' ? 'deleted' : 'answered')
    const result = await runWork({ do: 'change', change, choice, ...(note === undefined ? {} : { note }) }, { live, place: change.key })
    setChosen(null)
    if (result.tone !== 'done') return
    // The row leaves with its answer, so what hobkin said goes to the section.
    onDone?.()
    useWorkUi.getState().forget(change.key)
    if (result.text) useWorkUi.getState().note('finished', result)
  }

  // "Review again" runs the change review once more in the host. hobkin's own review, an agent run, is never asked for.
  const reviewAgain = async () => {
    if (!live) {
      useWorkUi.getState().note(change.key, { tone: 'refused', text: SAMPLE_REVIEW_AGAIN })
      return
    }
    try {
      await again()
      useWorkUi.getState().forget(change.key)
    } catch (error) {
      useWorkUi.getState().note(change.key, { tone: 'refused', text: error instanceof Error ? error.message : String(error) })
    }
  }

  return { busy, chosen, choose, reviewAgain }
}
