import { hostStore, runCommand } from '@/lib/host/client.ts'
import { dismissIdOf } from './dismiss.ts'
import type { WaitingRow } from './items.ts'
import { startAnswering, stopAnswering, useActionItems } from './store.ts'

/**
 * Dismisses an item with hobkin's own dismissal (`action.dismiss`). Its row leaves the list and every count at once, as an
 * answered one does, and comes back if hobkin refuses, with hobkin's reason. `said` gets what to say of it either way. False
 * when there is nothing for hobkin to dismiss, so the screen leaves the row where it is.
 */
export function dismissItem(row: WaitingRow, said: (text: string, refused: boolean) => void): boolean {
  const id = dismissIdOf(row, hostStore.getState().snapshot)
  if (!id || useActionItems.getState().answering.includes(row.id)) return false
  startAnswering(row.id)
  runCommand('action.dismiss', { ids: [id] }).then(
    () => {
      stopAnswering(row.id)
      said('Dismissed.', false)
    },
    (error: unknown) => {
      stopAnswering(row.id)
      said(error instanceof Error ? error.message : String(error), true)
    },
  )
  return true
}
