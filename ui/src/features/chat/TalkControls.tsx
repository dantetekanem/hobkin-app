import { ArrowUp, Square } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import type { QueuedRow } from '../work/talk.ts'

/**
 * The controls every message box shares, the main chat's and each agent's page: the one button that is Send, and Stop
 * while a turn runs, and the quiet rows for what waits for the turn. The keys are `composer-keys.ts`.
 */

export interface SendButtonProps {
  turnRunning: boolean
  canSend: boolean
  stopping: boolean
  onStop: () => void
  /** What the button sends to and stops, for a screen reader: "Send", "Stop hobkin", "Stop this agent". */
  sendLabel?: string
  stopLabel?: string
  /** The button's size, where a page's box is larger than the main chat's. */
  className?: string
}

/** Send, and Stop while a turn runs, in the same place and size, so nothing moves when it swaps. Its hover lists the keys for each. */
export function SendButton({ turnRunning, canSend, stopping, onStop, sendLabel = 'Send', stopLabel = 'Stop hobkin', className }: SendButtonProps) {
  const icon = 'col-start-1 row-start-1 transition-[opacity,transform] duration-[140ms] ease-out'
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type={turnRunning ? 'button' : 'submit'}
            onClick={turnRunning ? onStop : undefined}
            disabled={turnRunning ? stopping : !canSend}
            aria-label={turnRunning ? stopLabel : sendLabel}
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-full border outline-offset-2 transition-[transform,opacity,background-color,border-color,color] duration-[140ms] ease-out active:scale-[0.97] disabled:opacity-40',
              turnRunning ? 'border-border-strong bg-transparent text-foreground hover:bg-surface-2' : 'border-transparent bg-primary text-primary-foreground',
              className,
            )}
          />
        }
      >
        <ArrowUp className={cn(icon, 'size-4', turnRunning && 'scale-75 opacity-0')} aria-hidden="true" />
        <Square className={cn(icon, 'size-3 fill-current', !turnRunning && 'scale-75 opacity-0')} aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent>
        {turnRunning ? (
          <span className="grid grid-cols-[auto_auto] items-center gap-x-3 gap-y-1">
            <span>Stop</span>
            <span className="flex gap-1"><Kbd>esc</Kbd><Kbd>esc</Kbd><Kbd>⌃C</Kbd></span>
            <span>Steer</span>
            <Kbd>↵</Kbd>
            <span>Send after the turn</span>
            <Kbd>⌥↵</Kbd>
            <span>Stop and send now</span>
            <Kbd>⌃↵</Kbd>
          </span>
        ) : (
          <>
            Send <Kbd>↵</Kbd>
          </>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * What the user sent that waits for the running turn, a quiet line each with how it waits, newest last, until the turn
 * reads it. Alt+Up brings them back into the box, as Pi's does.
 */
export function QueuedRows({ rows, className }: { rows: readonly QueuedRow[]; className?: string }) {
  return (
    <ul aria-label="Waiting for this turn" className={cn('flex flex-col px-3', className)}>
      <AnimatePresence initial={false}>
        {rows.map((row, index) => (
          <motion.li
            key={row.key}
            initial={{ opacity: 0, transform: 'translateY(4px)' }}
            animate={{ opacity: 1, transform: 'translateY(0px)', transition: spring.alive }}
            exit={{ opacity: 0, transition: tween.exit }}
            className="flex min-w-0 items-center gap-2 pb-1 text-[12.5px] leading-5"
          >
            <span className="eyebrow shrink-0">{row.queue === 'follow-up' ? 'Follow-up' : 'Steer'}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.text}</span>
            {index === rows.length - 1 ? (
              <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-muted-foreground">
                <Kbd>⌥↑</Kbd> edit
              </span>
            ) : null}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}

/** Continue, after the user stopped a turn: the same as Enter in an empty box. */
export function ContinueButton({ onContinue, className }: { onContinue: () => void; className?: string }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full bg-surface-2 pr-1 pl-2 align-middle text-[12px] font-medium text-foreground outline-offset-1 transition-[transform,background-color] duration-[140ms] ease-out hover:bg-secondary active:scale-[0.97]',
        className,
      )}
      onClick={onContinue}
    >
      Continue
      <Kbd>↵</Kbd>
    </button>
  )
}

/** A message of pictures alone, in words. */
export const imagesLine = (count: number) => (count === 1 ? '1 image' : `${count} images`)
