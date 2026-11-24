import type { KeyboardEvent } from 'react'
import { cn } from '@/lib/utils.ts'
import { PAGE_ORDERS, type PageOrder } from './page-order.ts'

/**
 * The GitHub page's order, Newest or Oldest, in a fixed place beside the page's tabs, for both of them. A radio group
 * in the look of Work's order (`ui/src/features/work/OrderControl.tsx`): the chosen order is its one stop, and Left
 * and Right move along it and choose. One height whatever is chosen, and quieter than the rows. Spec: 024-github.
 */
export function OrderChoice({ value, onChoose }: { value: PageOrder; onChoose: (order: PageOrder) => void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!delta || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    const at = PAGE_ORDERS.findIndex((order) => order.value === value)
    const next = PAGE_ORDERS[Math.min(PAGE_ORDERS.length - 1, Math.max(0, at + delta))]!
    if (next.value === value) return
    event.currentTarget.querySelector<HTMLElement>(`[data-order="${next.value}"]`)?.focus({ preventScroll: true })
    onChoose(next.value)
  }

  return (
    <div role="radiogroup" aria-label="Order the lists" onKeyDown={onKeyDown} className="flex h-7 shrink-0 items-center gap-0.5">
      {PAGE_ORDERS.map((order) => {
        const selected = order.value === value
        return (
          <button
            key={order.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-order={order.value}
            data-stop={selected ? '' : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChoose(order.value)}
            className={cn(
              'inline-flex h-7 shrink-0 scroll-mt-[124px] items-center rounded-full px-2.5 text-[12.5px] font-medium whitespace-nowrap outline-offset-0 transition-colors duration-[160ms] ease-[ease]',
              selected ? 'bg-surface-2 text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {order.label}
          </button>
        )
      })}
    </div>
  )
}
