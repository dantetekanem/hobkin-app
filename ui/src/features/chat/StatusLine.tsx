import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useRef } from 'react'
import { Kbd } from '@/components/ui/kbd.tsx'
import { useHost } from '@/lib/host/index.ts'
import { dur, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { doingNow, elapsed, turnStartedAt } from './doing.ts'
import { useNow } from './use-now.ts'

export interface StatusLineProps {
  /** Why nothing can be sent, when that is so. */
  reason: string | null
  /** Why the last send, stop, attachment or command did not go through. */
  problem: string | null
  /** What the last command said. */
  said: string | null
  turnRunning: boolean
}

/** One line above the input: what hobkin is doing and for how long, what a command said, why the last action failed, or why nothing can be sent. */
export function StatusLine({ reason, problem, said, turnRunning }: StatusLineProps) {
  const doing = useHost((state) => doingNow(state.snapshot))
  const startedAt = useHost((state) => turnStartedAt(state.snapshot))
  const working = turnRunning && doing !== null
  const now = useNow(working)
  // hobkin's runs say when the turn began. Until they do, the moment this line appeared stands in.
  const seenAt = useRef<number | null>(null)
  if (!working) seenAt.current = null
  else seenAt.current ??= now
  const steady = useReducedMotion()

  const line = problem ? 'problem' : working ? 'doing' : said ? 'said' : reason ? 'reason' : null
  return (
    // The line's room is always there, so the input does not move when the line comes and goes.
    <div className="h-6 pl-[62px]">
      <AnimatePresence mode="wait" initial={false}>
        {line === null ? null : (
          <motion.div
            key={line}
            role={line === 'problem' ? 'alert' : 'status'}
            initial={{ opacity: 0, transform: 'translateY(6px)' }}
            animate={{ opacity: 1, transform: 'translateY(0px)', transition: tween.enter }}
            exit={{ opacity: 0, transform: 'translateY(4px)', transition: tween.exit }}
            className={cn('flex h-6 items-center gap-2 text-[12px]', line === 'problem' ? 'text-destructive' : 'text-muted-foreground')}
          >
            {line === 'problem' ? <span className="truncate">{problem}</span> : null}
            {line === 'said' ? <span className="truncate text-foreground">{said}</span> : null}
            {line === 'reason' ? <span className="truncate">{reason}</span> : null}
            {line === 'doing' ? (
              <>
                <motion.span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full bg-primary"
                  animate={steady ? undefined : { opacity: [1, 0.3, 1] }}
                  transition={{ duration: dur.travel * 2, repeat: Infinity, ease: 'linear' }}
                />
                <span className="truncate">
                  <span className="font-medium text-foreground">hobkin</span> is {doing}
                </span>
                <span className="tabular-nums">{elapsed(startedAt ?? seenAt.current ?? now, now)}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  <Kbd>esc</Kbd> stops
                </span>
              </>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
