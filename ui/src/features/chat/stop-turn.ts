import type { HostState } from '@/lib/host/state.ts'
import { executionTargets } from '../work/actions.ts'

/** The first Escape of a stop (`stop-key.ts`), and the turn of the main conversation it was pressed during. */
export interface ArmedStop {
  at: number
  turn: string
}

/** The main conversation's turn that can be stopped now, by its run id, or null while none runs. */
export function shownTurn(state: Pick<HostState, 'link' | 'home' | 'owner' | 'snapshot' | 'epoch'>): string | null {
  const main = executionTargets(state).find((target) => target.kind === 'main' && target.canStop)
  return main?.runId ?? null
}

/**
 * When the stop was armed, for the turn running now. A stop armed during a turn that has ended arms nothing for the
 * next one, even when the screen never showed a moment with no turn between them, as when a queued message starts
 * its turn within the frame the last one ended.
 */
export function armedAt(armed: ArmedStop | null, turn: string | null): number | null {
  if (armed === null || armed.turn !== turn) return null
  return armed.at
}

/** The id of Chat's line for a main turn the user stopped, as hobkin posts it (`noticeStop`, a card action): where Continue is offered. */
export const stopLineId = (runId: string): string => `notice:card:main-stop:${runId}`
