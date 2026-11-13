/**
 * An action item read here, the way a report is read. An item that is handled in Work is read here while work mode is
 * off, since Work would have nothing to do with it. Like every item, it can be talked over with hobkin (`discuss.ts`).
 */
import type { WaitingRow } from './items.ts'

/** Whether a row that would open in Work is read here instead: while work mode is off. */
export function readsHere(row: WaitingRow, workOn: boolean): boolean {
  return row.opens?.screen === 'work' && !workOn
}
