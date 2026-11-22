import type { ProofRunSummary } from '#shared/protocol/proofs.ts'
import { runsForItem, sameHead, specFile } from './proof-match.ts'

/**
 * A run's siblings (053-work-control-room, "Proofs"): the other model checks and proofs of the same change, in a fixed
 * order, which J and K move through and the heading counts ("Model 2 of 5"). The opener names them, as a change's chips
 * show them; a run opened by something that named none finds them in the proofs slice. Pure.
 */

const bySpec = (left: ProofRunSummary, right: ProofRunSummary) => specFile(left.spec).localeCompare(specFile(right.spec)) || left.spec.localeCompare(right.spec)

/** The runs on a project's default branch at `run`'s head: no item's. */
const onMain = (run: ProofRunSummary, runs: readonly ProofRunSummary[]) =>
  runs.filter((other) => other.project === run.project && !other.item && (!run.head || sameHead(other.head, run.head)))

/** The newest run of each spec of the change `run` checked, or of its project's default branch, by spec file. */
function changeRuns(run: ProofRunSummary, runs: readonly ProofRunSummary[]): ProofRunSummary[] {
  if (!run.project) return [run]
  const kin = run.item ? runsForItem({ runs: [...runs] }, run.project, run.item, run.head ?? null) : onMain(run, runs)
  // The run open stands for its spec, even when a newer run of that spec came since; otherwise the newest does.
  const newest = new Map<string, ProofRunSummary>([[run.spec, run]])
  for (const other of [...kin].sort((left, right) => Date.parse(right.started) - Date.parse(left.started))) {
    if (!newest.has(other.spec)) newest.set(other.spec, other)
  }
  return [...newest.values()].sort(bySpec)
}

export function siblingsOf(id: string | null, named: readonly string[], runs: readonly ProofRunSummary[]): string[] {
  if (!id) return []
  if (named.includes(id)) return [...named]
  const run = runs.find((candidate) => candidate.id === id)
  return run ? changeRuns(run, runs).map((sibling) => sibling.id) : [id]
}

/** The sibling J (1) or K (-1) goes to. Null at the ends. */
export function siblingAt(siblings: readonly string[], id: string, delta: 1 | -1): string | null {
  const at = siblings.indexOf(id)
  if (at < 0) return null
  return siblings[at + delta] ?? null
}

/** "Model 2 of 5". */
export function positionWords(siblings: readonly string[], id: string): string {
  const at = Math.max(0, siblings.indexOf(id))
  return `Model ${at + 1} of ${Math.max(1, siblings.length)}`
}

/** The runs a row of chips opens, each once, in the order they show. A model nothing checked has none. */
export function chipRuns(chips: readonly { id: string | null }[]): string[] {
  return [...new Set(chips.flatMap((chip) => (chip.id ? [chip.id] : [])))]
}
