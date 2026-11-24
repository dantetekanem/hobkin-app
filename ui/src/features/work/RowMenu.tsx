import { Ellipsis } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useView } from '@/app/view-store.ts'
import { Button } from '@/components/ui/button.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu.tsx'
import { finishedReviewId } from '@/features/review/entry.ts'
import { BIG_CHANGE_LINES } from '@/features/review/stack-start.ts'
import { useStackStart } from '@/features/review/use-stack-start.ts'
import type { FinishedChange } from '@/lib/host/index.ts'
import { openAddress } from '@/lib/open-link.ts'
import { menuItemsOf } from './row-menu.ts'
import type { useChangeActions } from './row-actions.ts'

/**
 * A row's "⋯": every action the change can take, so the row's one action is never the only way. It lists hobkin's own
 * choices for the change in its words, Review, Make it a stack above 300 lines, and a reply. Close without merging asks twice,
 * as it does in the open row. It is one of the row's own controls, in a fixed place right after its one action.
 */
type Actions = ReturnType<typeof useChangeActions>

const ARMED_MS = 10_000

export function RowMenu({ change, live, actions, reviewing, onReply }: { change: FinishedChange; live: boolean; actions: Actions; reviewing: boolean; /** Opens the row's reply box. Missing where the row has none. */ onReply?: () => void }) {
  const [open, setOpen] = useState(false)
  const [armed, setArmed] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const reviewId = finishedReviewId(change, live)
  const review = () => {
    if (reviewId) useView.getState().openReviewFor(reviewId)
  }
  // The list is worked out only while the menu is open.
  const items = open ? menuItemsOf(change, { canReview: Boolean(reviewId), reviewing, canReply: Boolean(onReply) }) : []
  const offersStack = Boolean(reviewId) && !change.stack && (change.size?.lines ?? 0) > BIG_CHANGE_LINES

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          clearTimeout(timer.current)
          setArmed(null)
        }
      }}
    >
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" data-row-control="" tabIndex={-1} aria-label={`More for ${change.title}`} title="Everything this change can do" className="shrink-0 text-muted-foreground" />}
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-56">
        {items.map((item) => {
          const disabled = item.disabled || (actions.busy && item.kind !== 'review' && item.kind !== 'open' && item.kind !== 'reply')
          const confirming = item.kind === 'confirm' && armed === item.id
          return (
            <DropdownMenuItem
              key={item.id}
              variant={item.destructive ? 'destructive' : 'default'}
              disabled={disabled}
              closeOnClick={!(item.kind === 'confirm' && !confirming)}
              onClick={() => {
                if (item.kind === 'review') review()
                else if (item.kind === 'open') openAddress(change.pr!)
                else if (item.kind === 'again') void actions.reviewAgain()
                else if (item.kind === 'reply') onReply?.()
                else if (item.kind === 'confirm' && !confirming) {
                  setArmed(item.id)
                  clearTimeout(timer.current)
                  timer.current = setTimeout(() => setArmed(null), ARMED_MS)
                } else if (item.choice) void actions.choose(item.choice)
              }}
            >
              {confirming ? `Press again: ${item.label}` : item.label}
            </DropdownMenuItem>
          )
        })}
        {offersStack ? <StackItem id={reviewId!} live={live} /> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Make it a stack, as the review's corner has it. It exists only while the menu is open, so a closed row holds no store for it. */
function StackItem({ id, live }: { id: string; live: boolean }) {
  const stack = useStackStart(id, live)
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={stack.busy} onClick={() => void stack.press()} title={stack.error ?? 'An agent splits the change into layers.'}>
        {stack.busy ? 'Starting the agent…' : 'Make it a stack'}
      </DropdownMenuItem>
    </>
  )
}
