import type { ProofRun } from '#shared/protocol/proofs.ts'

/**
 * The whole of each proof run that ended, as `proof.get` answered it (053-work-control-room, "Proofs"). A run that ended
 * never changes, and Run again starts a run of its own, so it is read once while the app is open: opening it again,
 * or coming back to it with J and K, asks hobkin nothing. The newest few are kept.
 */

const MOST = 30
// The window's one copy lives on globalThis, so a hot update of this file finds it instead of starting an empty one.
const holder = globalThis as { __hobkinEndedProofs?: Map<string, ProofRun> }
const ended = (holder.__hobkinEndedProofs ??= new Map())

export const endedRun = (id: string | null | undefined): ProofRun | undefined => (id ? ended.get(id) : undefined)

/** Keeps a run read whole, when it has ended. A run still checking is read again as it moves. */
export function rememberEnded(run: ProofRun): void {
  if (run.outcome === 'checking') return
  ended.delete(run.id)
  ended.set(run.id, run)
  for (const id of ended.keys()) {
    if (ended.size <= MOST) break
    ended.delete(id)
  }
}
