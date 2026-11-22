/**
 * The proof beside the review (053-work-control-room, "Proofs"): which of the change's models T opens, the models J and
 * K move through, what T and Shift+T do, and the room the panel takes. Pure.
 */
import { SIDE_BY_SIDE_PX } from '../../proofs/proof-layout.ts'
import type { Tone } from '../../proofs/run/run-view.ts'
import type { ModelRow } from '../story/node-models.ts'

type Row = Pick<ModelRow, 'run' | 'tone'>

/** What needs a look first: what fails, then what holds with a part that never ran, what still checks, what has no result here, and last what holds. */
const NEED: Readonly<Record<Tone, number>> = { bad: 0, warn: 1, live: 2, quiet: 3, ok: 4 }

/** The run T opens: the change's first model that needs a look, in the order the review lists them. Null when nothing checked any. */
export function firstToLook(rows: readonly Row[]): string | null {
  let first: Row | null = null
  for (const row of rows) if (row.run && (!first || NEED[row.tone] < NEED[first.tone])) first = row
  return first?.run ?? null
}

/** The change's model checks and proofs, in the order the review lists them: what J and K move through in the proof. */
export function proofSiblings(rows: readonly Row[]): string[] {
  return [...new Set(rows.flatMap((row) => (row.run ? [row.run] : [])))]
}

export type ProofMove =
  | { do: 'open'; run: string }
  | { do: 'close' }
  /** The full page: of `run`, or of the run the open proof shows now when null. */
  | { do: 'expand'; run: string | null }
  | { do: 'say'; text: string }

/**
 * T opens the proof beside the review on the change's first model that needs a look, and T again closes it. Shift+T
 * opens the full page: of that model while the proof is closed, of the model the proof shows while it is open.
 */
export function onProofKey(shown: string | null, rows: readonly Row[], shift: boolean): ProofMove {
  if (shown != null) return shift ? { do: 'expand', run: null } : { do: 'close' }
  const run = firstToLook(rows)
  if (run == null) return { do: 'say', text: rows.length === 0 ? 'This change has no TLA+ models.' : 'No model of this change was checked yet.' }
  return shift ? { do: 'expand', run } : { do: 'open', run }
}

/** The part of a session the proof's keys use. */
export interface ProofHolder {
  proof: { run: string; from: string | null } | null
  openProof(run: string, from?: string | null): void
  closeProof(): void
  say(text: string): void
}

/** Does what T or Shift+T means, from the control `from` names (`data-proof-from`), or the review itself when null. */
export function pressProof(session: ProofHolder, rows: readonly Row[], shift: boolean, from: string | null, expand: (run: string | null) => void): void {
  const move = onProofKey(session.proof?.run ?? null, rows, shift)
  switch (move.do) {
    case 'open':
      return session.openProof(move.run, from)
    case 'close':
      return session.closeProof()
    case 'expand':
      return expand(move.run)
    case 'say':
      return session.say(move.text)
  }
}

/** The panel's width with the check and the proof side by side: 1,100 pixels of content, its padding and a scroll bar. */
export const PROOF_SIDE = SIDE_BY_SIDE_PX + 60
/** Its width as tabs, beside a graph of middling room. */
export const PROOF_TABS = 600
/** The least of the graph that stays beside the panel. With less, the panel covers the graph instead. */
export const GRAPH_KEEPS = 420

export interface ProofRoom {
  width: number
  /** True when it covers the graph, from the review's panel to the right edge: there was no room for both. */
  covers: boolean
}

/**
 * The room the proof takes at the right of the review, from `room`, what the review's panel and the outline leave of
 * the canvas. Beside the graph it takes a fixed width, so nothing moves while its code loads: the check and the proof
 * side by side when there is room for that and the graph, else tabs. With no room for both it covers the graph, and
 * never the review's panel, where the verdict is.
 */
export function proofRoom(room: number): ProofRoom {
  const width = Math.max(0, Math.round(room))
  if (width >= PROOF_SIDE + GRAPH_KEEPS) return { width: PROOF_SIDE, covers: false }
  if (width >= PROOF_TABS + GRAPH_KEEPS) return { width: PROOF_TABS, covers: false }
  return { width, covers: true }
}
