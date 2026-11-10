import { AnimatePresence, motion } from 'motion/react'
import { holdStill, useStill } from '@/app/still.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import type { Bubble } from './bubble.ts'

const move = { default: spring.alive, opacity: tween.enter }

/**
 * What hobkin says by its face: a speech bubble that pops from the face beside the input, changes on a spring as
 * hobkin moves from thinking to writing, and leaves when there is nothing to say. Held still, it only fades. It
 * never takes a click or the keyboard, and sits above the input, so it is never in the way of typing.
 */
export function SpeechBubble({ bubble }: { bubble: Bubble | null }) {
  const still = useStill()
  return (
    <AnimatePresence initial={false}>
      {bubble ? (
        <motion.div
          key="bubble"
          layout={!still}
          role={bubble.kind === 'doing' ? 'status' : 'note'}
          initial={holdStill({ opacity: 0, transform: 'translate(-6px, 6px) scale(0.96)' }, still)}
          animate={holdStill({ opacity: 1, transform: 'translate(0px, 0px) scale(1)', transition: move }, still)}
          exit={holdStill({ opacity: 0, transform: 'translate(-4px, 4px) scale(0.96)', transition: tween.exit }, still)}
          transition={move}
          // It grows from its tail, which points at the face.
          style={{ transformOrigin: '0% 100%' }}
          className="pointer-events-none relative flex h-6 max-w-full min-w-0 items-center rounded-full border border-border bg-card px-2.5 text-[12px] shadow-xs select-none"
        >
          <span aria-hidden="true" className="absolute bottom-[5px] -left-[4.5px] size-2 rotate-45 border-b border-l border-border bg-card" />
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={`${bubble.kind}:${bubble.text}`}
              layout={still ? false : 'position'}
              initial={holdStill({ opacity: 0, transform: 'translateY(6px)' }, still)}
              animate={holdStill({ opacity: 1, transform: 'translateY(0px)', transition: move }, still)}
              exit={holdStill({ opacity: 0, transform: 'translateY(-6px)', transition: tween.exit }, still)}
              className="relative truncate"
            >
              {bubble.kind === 'tip' ? <span className="mr-1.5 font-heading text-muted-foreground">tip</span> : null}
              <span className={cn(bubble.kind === 'doing' ? 'text-foreground' : 'text-muted-foreground')}>{bubble.text}</span>
            </motion.span>
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
