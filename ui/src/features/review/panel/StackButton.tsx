import { useEffect, useRef } from 'react'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/utils.ts'
import { stackButton } from '../stack-start.ts'
import { useStackStart } from '../use-stack-start.ts'

/** The panel's "Make it a stack" state: the button, its refusal line, and the header the key reaches the button through. */
export function useStack({ id, live, merged, lines }: { id: string; live: boolean; merged: boolean; lines: number }) {
  const header = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const { busy, error, press } = useStackStart(id, live)
  const button = stackButton({ merged, busy, lines })

  // Shift+S reaches the header as `rv-stack`, from the review's key listener: the keyboard goes to the button, and Enter presses it.
  useEffect(() => {
    const element = header.current
    if (!element) return
    const focus = () => trigger.current?.focus({ preventScroll: true })
    element.addEventListener('rv-stack', focus)
    return () => element.removeEventListener('rv-stack', focus)
  }, [])

  return { header, trigger, button, error, press }
}

type Stack = ReturnType<typeof useStack>

/**
 * "Make it a stack", at the end of the size row (spec 060). Its words hold one width: "Starting…" lies over the same
 * place while the host is asked, so nothing beside it moves. Past 300 changed lines it takes the Outdated notice's
 * attention color, never the risk badge's.
 */
export function StackButton({ stack }: { stack: Stack }) {
  const { button, trigger } = stack
  if (!button.shown) return null
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            ref={trigger}
            type="button"
            data-stop
            aria-disabled={button.busy}
            onClick={() => void stack.press()}
            className={cn(
              'flex h-7 items-center rounded-full px-2.5 font-heading text-[13px] font-medium transition-transform duration-[140ms] ease-[var(--ease-out)] active:scale-[0.97]',
              button.emphasized ? 'bg-sun/15 text-sun-fg' : 'bg-background text-foreground',
              button.busy && 'opacity-60 active:scale-100',
            )}
          >
            <span className="grid justify-items-center">
              <span className={cn('col-start-1 row-start-1', button.busy && 'invisible')}>Make it a stack</span>
              <span className={cn('col-start-1 row-start-1', !button.busy && 'invisible')}>Starting…</span>
            </span>
          </button>
        }
      />
      <TooltipContent sideOffset={6}>
        {button.tooltip} <Kbd>⇧S</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

/** A host's refusal, or that a sample starts nothing, in one quiet line under the size row. It takes no room when there is none. */
export function StackLine({ stack }: { stack: Stack }) {
  if (!stack.error) return null
  return (
    <p role="alert" className="mt-2 text-[13px] leading-snug text-pretty text-bad-fg [overflow-wrap:anywhere]">
      {stack.error}
    </p>
  )
}
