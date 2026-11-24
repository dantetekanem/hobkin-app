import { useEffect, useState } from 'react'
import type { QueueRow, WorkState } from '#shared/protocol/work.ts'
import { runCommand } from '@/lib/host/index.ts'
import { queueSignature } from './queue-sheet.ts'

/**
 * Every row of hobkin's queue while the sheet is open. The status the window holds keeps only hobkin's first rows, so
 * the sheet asks the host for the whole queue when it opens and again when the queue changed, never on a timer. Until
 * the answer comes, and with no host or a host that does not know the command, it has the rows the page has.
 */
export function useWholeQueue(open: boolean, work: Pick<WorkState, 'queue' | 'queued'>, live: boolean): QueueRow[] {
  const [whole, setWhole] = useState<QueueRow[] | null>(null)
  const signature = queueSignature(work.queue, work.queued)

  useEffect(() => {
    if (!open || !live) {
      setWhole(null)
      return
    }
    let current = true
    runCommand('work.queue.all', {}).then(
      (answer) => {
        if (current) setWhole(answer.rows)
      },
      () => {
        // A host older than the command refuses it by name: the rows the page has are what there is.
        if (current) setWhole(null)
      },
    )
    return () => {
      current = false
    }
  }, [open, live, signature])

  return whole ?? work.queue
}
