import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { holdStill, useStill } from '@/app/still.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { useHost } from '@/lib/host/index.ts'
import { tween } from '@/lib/motion.ts'
import { useChat } from './chat-store.ts'
import { cn } from '@/lib/utils.ts'
import { bubbleNow, nextBubbleChange, reminderChoices, tipChoices, type Bubble } from './bubble.ts'
import { doingNow, elapsed, turnStartedAt } from './doing.ts'
import { SpeechBubble } from './SpeechBubble.tsx'
import { useNow } from './use-now.ts'

export interface StatusLineProps {
  /** Why nothing can be sent, when that is so. */
  reason: string | null
  /** Why the last send, stop, attachment or command did not go through. */
  problem: string | null
  /** What the last command said. */
  said: string | null
  turnRunning: boolean
  /** The message input holds text, so greetings and tips wait. */
  typing: boolean
}

/** The clock the greeting and the tips follow. It moves only when one of them starts or ends. */
function useBubbleClock(openedAt: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setTimeout(() => setNow(Date.now()), Math.max(50, nextBubbleChange(now, openedAt) - Date.now()))
    return () => clearTimeout(timer)
  }, [now, openedAt])
  return now
}

/**
 * The row above the input. hobkin speaks there in a bubble from its face: what its turn is doing, for how long and
 * how to stop it, or, while it waits, the terminal app's greeting and tips. A problem, what a command said, or why
 * nothing can be sent show there as a plain line.
 */
export function StatusLine({ reason, problem, said, turnRunning, typing }: StatusLineProps) {
  const doing = useHost((state) => doingNow(state.snapshot))
  const startedAt = useHost((state) => turnStartedAt(state.snapshot))
  const userName = useHost((state) => (typeof state.snapshot.userName === 'string' && state.snapshot.userName.trim() ? state.snapshot.userName.trim() : null))
  const learning = useHost((state) => state.snapshot.learning)
  const attention = useHost((state) => state.snapshot.reportAttention)
  const tips = useMemo(() => tipChoices({ learning }), [learning])
  const reminders = useMemo(() => reminderChoices({ reportAttention: attention }), [attention])
  const working = turnRunning && doing !== null
  const now = useNow(working)
  const [openedAt] = useState(() => Date.now())
  const clock = useBubbleClock(openedAt)
  const still = useStill()
  // hobkin's runs say when the turn began. Until they do, the moment this line appeared stands in.
  const seenAt = useRef<number | null>(null)
  if (!working) seenAt.current = null
  else seenAt.current ??= now

  const line = problem ? 'problem' : said ? 'said' : reason ? 'reason' : null
  const bubble = bubbleNow({ doing: working ? doing : null, typing, line, userName, openedAt, now: clock, tips, reminders })
  // A thought being read stays until the pointer or the keyboard leaves it.
  const [inspecting, setInspecting] = useState(false)
  const lastThought = useRef<Bubble | null>(null)
  if (bubble) lastThought.current = bubble
  const shown = bubble ?? (inspecting && (lastThought.current?.kind === 'tip' || lastThought.current?.kind === 'reminder') ? lastThought.current : null)
  const shownLine = shown ? null : line

  return (
    // The row's room is always there, so the input does not move when the bubble or a line comes and goes.
    <div className="relative flex h-6 items-center gap-2 pl-[112px]">
      <SpeechBubble bubble={shown} onInspect={setInspecting} />
      {bubble?.kind === 'doing' ? (
        <span className="ml-auto flex shrink-0 items-center gap-2 text-[12px] text-muted-foreground">
          <span className="tabular-nums">{elapsed(startedAt ?? seenAt.current ?? now, now)}</span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd> stops
          </span>
        </span>
      ) : null}
      <AnimatePresence mode="wait" initial={false}>
        {shownLine === null ? null : (
          <motion.div
            key={shownLine}
            // A problem goes by itself; while it is hovered or focused it stays so it can be read.
            onPointerEnter={shownLine === 'problem' ? () => useChat.getState().readProblem(true) : undefined}
            onPointerLeave={shownLine === 'problem' ? () => useChat.getState().readProblem(false) : undefined}
            onFocus={shownLine === 'problem' ? () => useChat.getState().readProblem(true) : undefined}
            onBlur={shownLine === 'problem' ? () => useChat.getState().readProblem(false) : undefined}
            role={shownLine === 'problem' ? 'alert' : 'status'}
            initial={holdStill({ opacity: 0, transform: 'translateY(6px)' }, still)}
            animate={holdStill({ opacity: 1, transform: 'translateY(0px)', transition: tween.enter }, still)}
            exit={holdStill({ opacity: 0, transform: 'translateY(4px)', transition: tween.exit }, still)}
            className={cn('flex h-6 min-w-0 items-center text-[12px]', shownLine === 'problem' ? 'text-destructive' : 'text-muted-foreground')}
          >
            <span className={cn('truncate', shownLine === 'said' && 'text-foreground')}>{shownLine === 'problem' ? problem : shownLine === 'said' ? said : reason}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
