import { ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { readLines, stackPlan } from '#shared/review/stack-plan.ts'
import type { ReviewStatus } from '#shared/review/status.ts'
import type { Review } from '#shared/review/types.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/utils.ts'
import { outdatedNotice } from './outdated.ts'
import { stackBox, stackBoxOpen, stackButton, type StackBox as StackBoxWords, type StackButtonInput } from './stack-button.ts'

/** The plan's state for the header: whether its box is open, what the button says, and the header the key reaches it by. */
export function useStack(review: Review, { live, preparation, ready }: { live: boolean; preparation: ReviewStatus | null; ready: boolean }) {
  const [open, setOpen] = useState(false)
  /** Opened by ⇧S: the keyboard goes into the box, so Escape closes it. */
  const [byKey, setByKey] = useState(false)
  const header = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const plan = useMemo(() => stackPlan(review), [review])
  const lines = useMemo(() => readLines(review), [review])
  const input: StackButtonInput = {
    merged: preparation?.landing?.state === 'merged',
    ready,
    // A review with no host behind it is a sample: nothing is made from it.
    sample: !live,
    outdated: live && preparation != null && outdatedNotice(review.change, preparation) != null,
    readLines: lines,
  }
  const button = stackButton(input)
  const usable = button.shown && !button.disabled

  const press = (viaKey: boolean) => {
    setByKey(viaKey)
    setOpen((before) => stackBoxOpen(before, 'toggle', button))
  }
  const close = () => {
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
  }
  // ⇧S reaches the header as `rv-stack`, from the review's key listener.
  const pressed = useRef(press)
  pressed.current = press
  useEffect(() => {
    const element = header.current
    if (!element) return
    const flip = () => pressed.current(true)
    element.addEventListener('rv-stack', flip)
    return () => element.removeEventListener('rv-stack', flip)
  }, [])

  return { header, trigger, open: open && usable, byKey, button, input, plan, press, close }
}

type Stack = ReturnType<typeof useStack>

/**
 * "Make it a stack", at the end of the size row. It is there from the first paint and disabled until the review is
 * ready, so nothing before it moves when the review arrives, and it keeps the same words and width in every state.
 * Past 300 changed lines a reviewer reads it takes the Outdated notice's attention color, never the risk badge's.
 */
export function StackButton({ stack }: { stack: Stack }) {
  const { button, open, trigger } = stack
  if (!button.shown) return null
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            ref={trigger}
            type="button"
            data-stop
            aria-expanded={open}
            aria-disabled={button.disabled}
            onClick={() => stack.press(false)}
            className={cn(
              'flex h-7 items-center gap-1 rounded-full px-2.5 font-heading text-[13px] font-medium transition-transform duration-[140ms] ease-[var(--ease-out)] active:scale-[0.97] [&_svg]:size-3.5',
              button.emphasized ? 'bg-sun/15 text-sun-fg' : 'bg-background text-foreground',
              button.disabled && 'opacity-50 active:scale-100',
            )}
          >
            Make it a stack
            <ChevronDown aria-hidden="true" className={cn('transition-transform duration-[160ms] ease-[var(--ease-out)]', open && 'rotate-180')} />
          </button>
        }
      />
      <TooltipContent sideOffset={6}>
        {button.tooltip} {button.disabled ? null : <Kbd>⇧S</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The plan for making the change a stack, under the panel's size row, opened in place as Description's box is, so it
 * pushes what is under it down and floats over nothing (spec 060). A heading, one row for each layer bottom first, and
 * Close. A long plan scrolls inside the box. Nothing can be built yet, so the line where Build will stand says so.
 * Escape closes it while the keyboard is in it, and the keyboard goes there when it opens.
 */
export function StackBox({ stack }: { stack: Stack }) {
  if (!stack.open) return null
  return <OpenBox words={stackBox(stack.input, stack.plan)} onClose={stack.close} takeKeyboard={stack.byKey} />
}

export function OpenBox({ words, onClose, takeKeyboard }: { words: StackBoxWords; onClose: () => void; takeKeyboard: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (takeKeyboard) box.current?.focus({ preventScroll: true })
  }, [takeKeyboard])

  return (
    <div
      ref={box}
      tabIndex={-1}
      role="region"
      aria-label="The plan for a stack"
      data-rv-stack-box
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      className="mt-2.5 flex flex-col gap-2 rounded-xl bg-background px-3 py-2.5 text-[13.5px] leading-snug outline-none"
    >
      <p className="text-[12.5px] text-muted-foreground">{words.heading}</p>
      {words.note ? <p className="text-[12.5px] text-muted-foreground">{words.note}</p> : null}
      {words.rows.length > 0 ? (
        <ol className="rv-scroll flex max-h-[42vh] flex-col gap-1.5 overflow-y-auto">
          {words.rows.map((row) => (
            <li key={row.number} tabIndex={0} className="rounded-md [overflow-wrap:anywhere] outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
              <span className="font-medium">{row.text}</span>
              {row.note ? <span className="block text-[12.5px] text-muted-foreground">{row.note}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">{words.footer}</p>
        <Button size="sm" variant="outline" data-stop className="h-7 shrink-0 px-2.5 text-[13px]" onClick={onClose}>
          Close
          <Kbd>esc</Kbd>
        </Button>
      </div>
    </div>
  )
}
