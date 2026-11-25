import { Check, CheckCheck } from 'lucide-react'
import { cn } from '@/lib/utils.ts'
import type { AgentNote } from './agent-threads.ts'

/**
 * How far a message the user sent an agent has got, under its words, as a chat app marks it: a faint check while it is
 * still on its way to the host, one once it waits for the agent, two once the agent took it in. One height for all
 * three, so the bubble never jumps. A message that was not sent, or not confirmed, says why instead.
 */
export function DeliveryMark({ delivery, why }: { delivery: AgentNote['delivery'] | null; why?: string }) {
  if (delivery === 'sending' || delivery === 'waiting' || delivery === 'received') {
    return (
      <p role="status" className="-mr-1 -mb-0.5 flex h-4 justify-end text-muted-foreground">
        {delivery === 'received' ? <CheckCheck className="size-3.5" aria-hidden="true" /> : <Check className={cn('size-3.5', delivery === 'sending' && 'opacity-40')} aria-hidden="true" />}
        <span className="sr-only">{delivery === 'received' ? 'Received' : delivery === 'waiting' ? 'Waiting' : 'Sending'}</span>
      </p>
    )
  }
  if (!delivery) return null
  return (
    <p role="status" className={cn('mt-1 text-[11px] leading-normal', delivery === 'local' ? 'text-muted-foreground' : 'text-bad-fg')}>
      {delivery === 'refused' ? `Not sent · ${why}` : delivery === 'unconfirmed' ? `Delivery not confirmed · ${why}` : 'Sample message · kept in this window only.'}
    </p>
  )
}
