import { planWork, rowWait, type Plan } from 'hobkin/src/cli/work/plan.mjs'
import type { WholeQueue } from '#shared/protocol/work.ts'
import type { HostHandlers } from './commands.ts'
import { itemsReader, queueWithItems, type ItemOf } from './work-items.ts'
import { queueRowOf } from './work.ts'

/**
 * The queue's whole list, read from hobkin's own plan on the window's ask. hobkin's status sends its first fifty
 * waiting rows and every skipped one (`MAX_PLAN_SENT` in its `src/cli/work/commands.mjs`), so a longer queue reaches the
 * window cut short. This reads and changes nothing.
 */
export function wholeQueue(plan: Plan, itemOf: ItemOf): WholeQueue {
  const rows = plan.entries.map((entry) => queueRowOf({ ...entry, item: entry.item?.id ?? null, waiting: rowWait(entry, plan.free) }))
  const waiting = rows.filter(({ skipped }) => !skipped)
  return { rows: queueWithItems([...waiting, ...rows.filter(({ skipped }) => skipped)], itemOf), queued: waiting.length }
}

export interface QueueSeat {
  /** hobkin's application, which holds the director that knows what runs now. Throws, with the reason, while it is not open in this host. */
  app: () => object
  root: () => string
  /** hobkin's plan, unless a test says otherwise. */
  plan?: (root: string, outlook: Record<string, unknown>) => Plan
  itemOf?: ItemOf
}

/** `work.queue.all`, which only reads. */
export function workQueueHandlers({ app, root, plan = planWork, itemOf }: QueueSeat): Pick<HostHandlers, 'work.queue.all'> {
  return {
    'work.queue.all': () => {
      const outlook = (app() as { director?: { outlook?: () => Record<string, unknown> } }).director?.outlook?.() ?? {}
      return wholeQueue(plan(root(), outlook), itemOf ?? itemsReader(root))
    },
  }
}
