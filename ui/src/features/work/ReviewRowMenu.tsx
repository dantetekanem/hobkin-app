import { Ellipsis } from 'lucide-react'
import { Fragment, memo, useState } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu.tsx'

/** One thing a Review row's menu does. */
export interface ReviewRowMenuItem {
  key: string
  label: string
  /**
   * What the item does. It may return a promise, and says whether the menu stays open after: an item that asks for a
   * second press stays, so the same place now says "Click again to confirm"; any other closes the menu.
   */
  onSelect: () => void | boolean | Promise<void | boolean>
  /** Marks a destructive item, such as Remove. */
  destructive?: boolean
  /** A rule above it, between kinds of action. */
  ruleBefore?: boolean
  disabled?: boolean
}

/**
 * The "..." at the end of a Review row, in the same place on every row: a menu of everything the row can do. Arrows
 * move along it, Enter does the one under focus and Escape closes it. An item that returns true keeps the menu open, as
 * one that waits for its second press does.
 */
export const ReviewRowMenu = memo(function ReviewRowMenu({ label, items }: { label: string; items: readonly ReviewRowMenuItem[] }) {
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" data-stop="" aria-label={label} title="Everything this review can do" className="shrink-0 text-muted-foreground" />}>
        <Ellipsis aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-56">
        {items.map((item) => (
          <Fragment key={item.key}>
            {item.ruleBefore ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              variant={item.destructive ? 'destructive' : 'default'}
              disabled={item.disabled}
              closeOnClick={false}
              onClick={() => {
                void Promise.resolve(item.onSelect()).then((stay) => {
                  if (!stay) setOpen(false)
                })
              }}
            >
              {item.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
