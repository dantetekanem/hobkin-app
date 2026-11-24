import { memo, type KeyboardEvent } from 'react'
import { cn } from '@/lib/utils.ts'
import { ORDERS, type Order } from './change-list.ts'

/**
 * The order of Work's finished changes, in a fixed place beside the section's heading. A radio group like the project
 * chips: the chosen order is its one stop, Left and Right move along it and choose. One height whatever is chosen, and
 * quieter than the rows.
 */
export const OrderControl = memo(function OrderControl({ value, onChoose }: { value: Order; onChoose: (order: Order) => void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!delta || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    event.preventDefault()
    const at = ORDERS.findIndex(({ order }) => order === value)
    const next = ORDERS[Math.min(ORDERS.length - 1, Math.max(0, at + delta))]!
    if (next.order === value) return
    event.currentTarget.querySelector<HTMLElement>(`[data-order="${next.order}"]`)?.focus({ preventScroll: false })
    onChoose(next.order)
  }

  return (
    <div role="radiogroup" aria-label="Order the finished changes" onKeyDown={onKeyDown} className="-mx-1 flex h-7 min-w-0 items-center gap-0.5 overflow-x-auto overflow-y-hidden px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {ORDERS.map(({ order, label }) => {
        const selected = order === value
        return (
          <button
            key={order}
            type="button"
            role="radio"
            aria-checked={selected}
            data-order={order}
            data-stop={selected ? '' : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChoose(order)}
            className={cn(
              'inline-flex h-7 shrink-0 scroll-mt-[124px] items-center rounded-full px-2.5 text-[12.5px] font-medium whitespace-nowrap outline-offset-0 transition-colors duration-[160ms] ease-[ease]',
              selected ? 'bg-surface-2 text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
})
