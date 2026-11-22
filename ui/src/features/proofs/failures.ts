import type { ProofObligation, ProofRun } from '#shared/protocol/proofs.ts'
import type { KeptRun } from './kept.ts'
import { relatedDefinition } from './math/proof-tree.ts'

/**
 * What failed in a proof run, for F and Shift+F and the counts beside them (053-work-control-room, "Proofs"): the step
 * of the trace where a rule breaks, then each proof step that failed, is missing or was omitted, in the tree's order.
 * A step still waiting has not failed. Pure, so the walk is tested without a window.
 */

export type Failure =
  /** The trace's step where the rule breaks, from 0. */
  | { part: 'graph'; step: number }
  /** A proof step, by its place in the tree, and the definition it is about. */
  | { part: 'math'; index: number; about: string | null }

const FAILING: ReadonlySet<ProofObligation['status']> = new Set(['failed', 'missing', 'omitted'])

type Failing = Pick<ProofRun, 'outcome' | 'trace' | 'proof' | 'definitions'>

export function failuresOf(run: Failing): Failure[] {
  const failures: Failure[] = []
  const trace = run.trace?.length ?? 0
  if (run.outcome === 'broken' && trace > 0) failures.push({ part: 'graph', step: trace - 1 })

  const names = run.definitions.map((definition) => definition.name)
  run.proof?.obligations.forEach((step, index) => {
    if (FAILING.has(step.status)) failures.push({ part: 'math', index, about: relatedDefinition(step.label, names) })
  })
  return failures
}

/** The failure F (1) or Shift+F (-1) goes to from `at`, round again at the ends. Null when nothing failed. */
export function stepFailure(count: number, at: number | null, delta: 1 | -1): number | null {
  if (count === 0) return null
  if (at === null || at >= count) return delta > 0 ? 0 : count - 1
  return (at + delta + count) % count
}

const failingOf = (proof: NonNullable<ProofRun['proof']>) => proof.obligations.filter((step) => FAILING.has(step.status)).length

/** The tree's count, beside it: "3 of 9 steps fail", or how many steps it has when none fails. */
export function failingLine(proof: NonNullable<ProofRun['proof']>): string {
  const all = proof.obligations.length
  const failing = failingOf(proof)
  if (failing === 0) return `${all} ${all === 1 ? 'step' : 'steps'}`
  return `${failing} of ${all} steps ${failing === 1 ? 'fails' : 'fail'}`
}

/** The heading's count of what failed: "Breaks at step 6 · 1 of 17 steps fails", or that nothing failed. */
export function failureLine(run: Failing): string {
  const failures = failuresOf(run)
  const parts: string[] = []
  const trace = failures.find((failure) => failure.part === 'graph')
  if (trace) parts.push(`Breaks at step ${trace.step + 1}`)
  if (run.proof && failingOf(run.proof) > 0) parts.push(failingLine(run.proof))
  if (parts.length) return parts.join(' · ')
  return run.outcome === 'checking' ? 'Nothing failed so far' : 'Nothing failed'
}

/** What a run keeps once F went to a failure: its part shows, with the broken state or the failed step picked. */
export function failureAt(kept: KeptRun, failure: Failure, index: number): KeptRun {
  if (failure.part === 'graph') {
    return {
      ...kept,
      tab: 'graph',
      graph: { ...kept.graph, picked: null },
      failure: index,
    }
  }
  return {
    ...kept,
    tab: 'math',
    math: { ...kept.math, step: failure.index, block: failure.about },
    failure: index,
  }
}

/**
 * Lands a run where its opener asked, once the run is whole: "Proof fails" at the first proof step that failed, a broken
 * model at the trace's break. A run with nothing there lands nowhere, and the ask is dropped either way.
 */
export function land(run: Failing, kept: KeptRun): KeptRun {
  if (!kept.landing) return kept
  const want = kept.landing === 'proof' ? 'math' : 'graph'
  const failures = failuresOf(run)
  const index = failures.findIndex((failure) => failure.part === want)
  const landed = { ...kept, landing: null }
  return index < 0 ? landed : failureAt(landed, failures[index]!, index)
}
