import { motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { useStill } from '@/app/still.ts'
import { Button } from '@/components/ui/button.tsx'
import { CONFIRM_MS, createTwoClicks } from '@/lib/two-clicks.ts'
import { cn } from '@/lib/utils.ts'
import type { HobkinChoice } from './actions.ts'

/** The controls a finished change's row and its open row share: the clamped line, Close without merging asked twice, and the reply box. */

/** What a choice says while hobkin carries it out. */
export const UNDER_WAY: Partial<Record<HobkinChoice, string>> = { merge: 'Merging…', mergePr: 'Merging…', refreshMerge: 'Asking for its refresh…' }

/** The row's own "Review again", in place of hobkin's "Get it reviewed": the change review once more, never an agent run. */
export const REVIEW_AGAIN_TITLE = 'Runs the change review again at this commit: its tests and one model pass.'
export const SAMPLE_REVIEW_AGAIN = 'This is sample data, so no change review runs here.'

export const prNumber = (url: string) => /\/pull\/(\d+)/.exec(url)?.[1]

/** The yes that lands a change stands out, unless its change review says it needs the user. Every other choice stays quiet. */
export function variantOf(choice: HobkinChoice, risky: boolean): 'default' | 'outline' | 'ghost' {
  const lands = choice === 'merge' || choice === 'mergePr' || choice === 'refreshMerge' || choice === 'rebase'
  if (!lands) return 'ghost'
  return risky ? 'outline' : 'default'
}

const CLAMP = { 2: 'line-clamp-2', 4: 'line-clamp-4' } as const

/**
 * A line that shows two or four lines at most, and all of it on "Show all". Its whole text is also its title.
 */
export function ClampedLine({ text, label, lines = 2, className }: { text: string; label?: ReactNode; lines?: keyof typeof CLAMP; className?: string }) {
  const [open, setOpen] = useState(false)
  const [clamped, setClamped] = useState(false)
  const line = useRef<HTMLSpanElement | null>(null)

  useLayoutEffect(() => {
    const element = line.current
    if (!element || open) return
    const measure = () => setClamped(element.scrollHeight > element.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text, open])

  return (
    <div className={cn('flex flex-col items-start gap-0.5', className)}>
      <span ref={line} title={text} className={cn('text-[13px] leading-snug break-words', !open && CLAMP[lines])}>
        {label}
        {text}
      </span>
      {clamped || open ? (
        <button
          type="button"
          tabIndex={-1}
          data-row-control=""
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="rounded-full text-[12px] font-medium text-muted-foreground underline-offset-2 transition-colors duration-[160ms] ease-[ease] hover:text-foreground hover:underline"
        >
          {open ? 'Show less' : 'Show all'}
        </button>
      ) : null}
    </div>
  )
}

/**
 * Close without merging, hobkin's own done, confirmed in place with the same two clicks as an integration's close
 * buttons (`lib/two-clicks.ts`): the first turns it into "Click again to close" for ten seconds, a line along its foot running
 * out over them, and the second closes it. Escape, moving away from it or the ten seconds take the first click back.
 */
export function CloseWithoutMerging({ label, busy, onClose }: { label: string; busy: boolean; onClose: () => Promise<void> }) {
  const still = useStill()
  const latest = useRef(onClose)
  useEffect(() => {
    latest.current = onClose
  })
  const [flow] = useState(() =>
    createTwoClicks({
      initial: '',
      run: async () => {
        await latest.current()
        return ''
      },
    }),
  )
  useEffect(() => () => flow.dispose(), [flow])
  const { armed, busy: closing } = useStore(flow)

  // Focus that moves to another control takes the first click back. A click that focuses nothing names nowhere, and the ten seconds see to it.
  const onBlur = (event: FocusEvent<HTMLButtonElement>) => {
    if (armed && event.relatedTarget instanceof Node) flow.cancel()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Escape' || !armed) return
    // Escape takes the first click back; the screen then steps back onto the row.
    flow.cancel()
  }

  return (
    <Button
      variant="ghost"
      tabIndex={-1}
      data-row-control=""
      size="sm"
      disabled={busy}
      focusableWhenDisabled
      aria-pressed={armed}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      onClick={() => void flow.press()}
      className={cn('relative overflow-hidden', armed ? 'bg-foreground text-background hover:bg-foreground hover:text-background' : 'text-bad-fg')}
    >
      {closing ? 'Closing…' : armed ? 'Click again to close' : label}
      {armed && !still ? (
        <motion.span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-current opacity-55"
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: CONFIRM_MS / 1000, ease: 'linear' }}
        />
      ) : null}
    </Button>
  )
}

/** The user's own words for what to change, or their answer to a run's note. An agent goes back to the change with them, first in the queue. */
export function ReplyBox({ busy, onSend, onCancel }: { busy: boolean; onSend: (note: string) => void; onCancel: () => void }) {
  const still = useStill()
  const [note, setNote] = useState('')
  const field = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => field.current?.focus({ preventScroll: true }), [])
  const words = note.trim()

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && words && !busy) {
      event.preventDefault()
      onSend(words)
    } else if (event.key === 'Escape') {
      // Used here, so the frame leaves it alone.
      event.preventDefault()
      onCancel()
    }
  }

  return (
    <motion.div
      className="flex items-end gap-2"
      initial={still ? { opacity: 0 } : { opacity: 0, transform: 'translateY(-6px)' }}
      animate={still ? { opacity: 1 } : { opacity: 1, transform: 'translateY(0px)' }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', duration: 0.36, bounce: 0.1 }}
    >
      <textarea
        ref={field}
        rows={2}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Type your answer, then Enter. Shift and Enter start a new line."
        aria-label="The changes to ask for"
        className="min-h-[3.25rem] min-w-0 flex-1 resize-none rounded-2xl border-[1.5px] border-input bg-surface px-3.5 py-2 text-[13px] leading-snug outline-none placeholder:text-muted-foreground focus-visible:border-ring"
      />
      <Button size="sm" disabled={!words || busy} onClick={() => onSend(words)}>
        Send
      </Button>
    </motion.div>
  )
}
