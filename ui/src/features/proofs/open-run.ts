import type { ProofRun } from '#shared/protocol/proofs.ts'
import { useView } from '@/app/view-store.ts'
import { land } from './failures.ts'
import { keep, keptOf, nameSiblings, type Landing, type ProofTab } from './kept.ts'
import type { ProofLayout } from './proof-layout.ts'

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

/**
 * Shows a part of an open run: its tab in tabs (side by side every part shows), landed where asked, as the Proof step
 * and the broken rule of the Run part do. Returns where the keyboard should go in it, when that is one step.
 */
export function choosePart(
  run: Pick<ProofRun, 'id' | 'outcome' | 'trace' | 'proof' | 'definitions'>,
  layout: ProofLayout,
  part: ProofTab,
  landing?: Landing,
): string | undefined {
  if (landing) keep(run.id, (kept) => land(run, { ...kept, landing }))
  if (layout === 'tabs') keep(run.id, (kept) => (kept.tab === part ? kept : { ...kept, tab: part }))

  const step = keptOf(run.id).math.step
  return landing === 'proof' && step !== null ? `[data-proof-step="${step}"]` : undefined
}
