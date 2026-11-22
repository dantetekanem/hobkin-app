import { useView } from '@/app/view-store.ts'
import { keep, nameSiblings, type Landing } from './kept.ts'

/**
 * Opens a proof run on its page among its siblings (053-work-control-room, "Proofs"): the other model checks and proofs
 * of the same change, in the order the opener shows them, which J and K then move through. `landing` opens it where
 * it matters: "Proof fails" at the proof tree's first failed step, a broken model at the trace's break. Without one it
 * shows what it was left at. Siblings that leave the run out are not kept: the page finds the change's runs itself.
 */
export function openRunAmong(id: string, siblings: readonly string[] = [], landing: Landing | null = null): void {
  nameSiblings(siblings.includes(id) ? siblings : [])
  if (landing) keep(id, (kept) => ({ ...kept, tab: landing === 'proof' ? 'math' : 'graph', landing }))
  useView.getState().openProofRun(id)
}
