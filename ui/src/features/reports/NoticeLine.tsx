import { Check, CircleX, CornerDownLeft, Trash, Undo2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { spring, tween } from '@/lib/motion.ts'
import { useStill } from './still.ts'

/**
 * One line at the foot of the screen: a delete that can still be undone, where a reply is going, or what hobkin
 * said of something it was asked to do, in its own words (`refused` when it would not).
 */
export type Line =
  | { key: number; kind: 'deleted'; title: string; until: number }
  | { key: number; kind: 'replying'; title: string }
  | { key: number; kind: 'said'; text: string; refused?: boolean }

/** How long the line about a reply stays. */
export const REPLY_LINE_MS = 4000

/**
 * The line rises from the foot of the screen and sinks back. A new line takes the old one's place. A delete's
 * line runs down as its time to undo does, and once it is gone the delete stands.
 */
export function NoticeLine({ line, onUndo }: { line: Line | null; onUndo: () => void }) {
  const still = useStill()

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-2">
      <AnimatePresence mode="popLayout">
        {line ? (
          <motion.div
            key={line.key}
            role="status"
            className="pointer-events-auto relative flex max-w-full items-center gap-2.5 overflow-hidden rounded-full border border-border bg-background py-1.5 pr-1.5 pl-4 text-[13px] shadow-float"
            initial={still ? { opacity: 0 } : { opacity: 0, transform: 'translateY(28px) scale(0.96)' }}
            animate={{ opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.alive, opacity: tween.enter } }}
            exit={still ? { opacity: 0, transition: tween.exit } : { opacity: 0, transform: 'translateY(14px) scale(0.98)', transition: tween.exit }}
          >
            {line.kind === 'deleted' ? (
              <>
                <Trash className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 truncate">
                  Deleted <span className="font-medium">{line.title}</span>
                </span>
                <Button variant="outline" size="sm" tabIndex={-1} onClick={onUndo} className="shrink-0">
                  <Undo2 aria-hidden="true" />
                  Undo
                  <Kbd>u</Kbd>
                </Button>
                {/* The time left to undo, running down. */}
                <motion.span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-primary"
                  initial={{ transform: 'scaleX(1)' }}
                  animate={{ transform: 'scaleX(0)' }}
                  transition={{ duration: Math.max(0, line.until - Date.now()) / 1000, ease: 'linear' }}
                />
              </>
            ) : line.kind === 'replying' ? (
              <>
                <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 truncate py-1 pr-2.5">
                  <span className="font-medium">{line.title}</span> goes with your next message.
                </span>
              </>
            ) : (
              <>
                {line.refused ? (
                  <CircleX className="size-3.5 shrink-0 text-bad-fg" aria-hidden="true" />
                ) : (
                  <Check className="size-3.5 shrink-0 text-ok-fg" aria-hidden="true" />
                )}
                <span className="min-w-0 py-1 pr-2.5 leading-snug">{line.text}</span>
              </>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
