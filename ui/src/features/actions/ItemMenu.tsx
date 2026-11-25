import { Ellipsis } from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu.tsx'
import { canDismiss } from './dismiss.ts'
import type { WaitingRow } from './items.ts'

/**
 * A card's "⋯": everything the item can do, so the card's own action is never the only way. It opens the item, talks it
 * over with hobkin, opens a finished branch in Review, and dismisses what hobkin lists. It sits last on the card, so it is
 * always in the same place.
 */
export function ItemMenu({ row, action, onAsk, onReview, onDiscuss, onDismiss }: {
  row: WaitingRow
  /** The card's own action, in its words: Reply, or Read. */
  action: string
  onAsk: (row: WaitingRow) => void
  onReview: (row: WaitingRow) => void
  onDiscuss: (row: WaitingRow) => void
  onDismiss: (row: WaitingRow) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            tabIndex={-1}
            data-row-control=""
            aria-label={`More for ${row.summary}`}
            title="Everything this item can do"
            className="pointer-events-auto text-muted-foreground"
          />
        }
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-52">
        <DropdownMenuItem onClick={() => onAsk(row)}>
          {action}
          <DropdownMenuShortcut>↵</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onDiscuss(row)}>
          Discuss with hobkin
          <DropdownMenuShortcut>r</DropdownMenuShortcut>
        </DropdownMenuItem>
        {row.branch ? <DropdownMenuItem onClick={() => onReview(row)}>Review</DropdownMenuItem> : null}
        {canDismiss(row) ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDismiss(row)}>
              Dismiss
              <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
