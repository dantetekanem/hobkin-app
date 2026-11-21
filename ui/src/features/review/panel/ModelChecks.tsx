import type { ProofChip } from '../../proofs/proof-match.ts'
import { ProofChipList } from '../../proofs/ProofChips.tsx'

/**
 * The change's TLA+ model checks in the panel (050-tla-proofs), as the finished card draws them: whether each model
 * held, broke or is still checking at the reviewed head, each chip opening its run. One under the other, so a check
 * that ends never moves the next.
 */
export function ModelChecks({ chips, heading }: { chips: readonly ProofChip[]; heading: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className={heading}>Model checks</h3>
      <ProofChipList chips={chips} inRow={false} stacked />
    </div>
  )
}
