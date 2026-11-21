import { useMemo } from 'react'
import type { ReviewNode } from '#shared/review/types.ts'
import { useProofRuns } from '../../proofs/use-proof-run.ts'
import { useSession } from '../state/context.tsx'
import { modelLines, modelsIn, reviewedChange, type ModelLine } from './node-models.ts'

/**
 * What TLC said at the reviewed head of each model in focus, from the `proofs` slice, so a check that runs moves on the
 * card as it runs. None for a pull request, or for a focus with no model file.
 */
export function useModelLines(focus: readonly string[]): ModelLine[] {
  const review = useSession((session) => session.review)
  const nodeOf = useSession((session) => session.nodeOf)
  const { proofs } = useProofRuns()
  const key = focus.join(' ')
  return useMemo(() => {
    const change = reviewedChange(review)
    if (!change) return []
    const nodes = key.split(' ').map((id) => nodeOf.get(id)).filter((node): node is ReviewNode => node != null)
    return modelLines(proofs, change, modelsIn(nodes, review.files))
  }, [key, nodeOf, proofs, review])
}
