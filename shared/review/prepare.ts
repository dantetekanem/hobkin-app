/**
 * Preparing a review, end to end. The passes are in their own files:
 *
 *   1. capture.ts   both sides of every changed file, fingerprinted
 *   2. units.ts     units, test pairing and references
 *   3. draft.ts     nodes and host wires, and the spec's acceptance lines
 *   4. model.ts     what the model returned, read without trust (the model run itself belongs to the host)
 *   5. complete.ts  check, complete, lay out and validate
 */
import { completeReview } from './complete.ts'
import { draftReview, type PrepareInput } from './draft.ts'
import type { Review } from './types.ts'

export { completeReview, type Completed } from './complete.ts'
export { draftReview, modelRequest, type CandidateWire, type Draft, type ModelRequest, type PrepareInput } from './draft.ts'
export type { ModelPassInput } from './model.ts'

/** Prepares a review in one call. Without model output the host's own wires and a plain story are used. */
export async function prepareReview(input: PrepareInput, modelOutput?: unknown): Promise<Review> {
  return (await completeReview(await draftReview(input), modelOutput)).review
}
