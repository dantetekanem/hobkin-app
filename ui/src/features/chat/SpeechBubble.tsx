import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { holdStill, useStill } from '@/app/still.ts'
import { bubbleCue } from '@/features/sound/cues.ts'
import { play } from '@/features/sound/index.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import type { Bubble } from './bubble.ts'

const move = { default: spring.alive, opacity: tween.enter }

/**
 * What hobkin says by its face: a speech bubble that pops from the face beside the input, changes on a spring as
 * hobkin moves from thinking to writing, and leaves when there is nothing to say. Held still, it only fades. It
 * hobkin's tips and reminders are thoughts: small circles trail from the bubble down to the face, and hovering or
 * focusing the bubble opens it upward to its whole text. It sits above the input, never over it. Its position is the
 * status row's: the bubble hangs from the row's bottom edge, which is the top of the face.
 */
export function SpeechBubble({ bubble, onInspect }: { bubble: Bubble | null; onInspect?: (inspecting: boolean) => void }) {
  const still = useStill()
  const thought = bubble?.kind === 'tip' || bubble?.kind === 'reminder'
  // A new line hobkin says babbles once. The ref outlives a hot update, so an update does not say the line again.
  const heard = useRef(bubble)
  useEffect(() => {
    const cue = bubbleCue(heard.current, bubble)
    heard.current = bubble
    if (cue) play(cue.name, cue.detail)
  }, [bubble])
  return (
    <AnimatePresence initial={false}>
      {bubble ? (
        <motion.div
          key="bubble"
          layout={!still && !thought}
          role={bubble.kind === 'doing' ? 'status' : 'note'}
          initial={holdStill({ opacity: 0, transform: 'translate(-6px, 6px) scale(0.96)' }, still)}
          animate={holdStill({ opacity: 1, transform: 'translate(0px, 0px) scale(1)', transition: move }, still)}
          exit={holdStill({ opacity: 0, transform: 'translate(-4px, 4px) scale(0.96)', transition: tween.exit }, still)}
          transition={move}
          // It grows from its tail, which points at the face.
          style={{ transformOrigin: '0% 100%' }}
          tabIndex={thought ? 0 : undefined}
          onPointerEnter={thought ? () => onInspect?.(true) : undefined}
          onPointerLeave={thought ? () => onInspect?.(false) : undefined}
          onFocus={thought ? () => onInspect?.(true) : undefined}
          onBlur={thought ? () => onInspect?.(false) : undefined}
          className={cn(
            'group/bubble absolute bottom-0 left-[96px] z-20 flex min-h-6 min-w-0 items-center rounded-full border border-border bg-card px-2.5 text-[12px] shadow-xs',
            thought
              ? 'max-w-[calc(100%-96px)] cursor-default outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring hover:rounded-2xl hover:py-1 focus-visible:rounded-2xl focus-visible:py-1'
              : // While a turn runs it ends before what the row keeps at its right: 196px, or what the row says beside a schedule (`--status-reserve`).
                cn('pointer-events-none h-6 select-none', bubble.kind === 'doing' ? 'max-w-[calc(100%-var(--status-reserve,196px))]' : 'max-w-[calc(100%-96px)]'),
          )}
        >
          {thought ? (
            <>
              <span aria-hidden="true" className="pointer-events-none absolute -bottom-[9px] -left-[8px] size-2.5 rounded-full border border-border bg-card" />
              <span aria-hidden="true" className="pointer-events-none absolute -bottom-[20px] -left-[16px] size-1.5 rounded-full border border-border bg-card" />
            </>
          ) : (
            <span aria-hidden="true" className="absolute bottom-[5px] -left-[4.5px] size-2 rotate-45 border-b border-l border-border bg-card" />
          )}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={`${bubble.kind}:${bubble.text}`}
              layout={still ? false : 'position'}
              initial={holdStill({ opacity: 0, transform: 'translateY(6px)' }, still)}
              animate={holdStill({ opacity: 1, transform: 'translateY(0px)', transition: move }, still)}
              exit={holdStill({ opacity: 0, transform: 'translateY(-6px)', transition: tween.exit }, still)}
              className={cn('relative min-w-0', thought ? 'truncate group-hover/bubble:whitespace-normal group-focus-visible/bubble:whitespace-normal' : 'truncate')}
            >
              {thought ? <span className="mr-1.5 font-heading text-muted-foreground">{bubble.kind === 'tip' ? 'tip' : 'reminder'}</span> : null}
              <span className={cn(bubble.kind === 'doing' ? 'text-foreground' : 'text-muted-foreground')}>{bubble.text}</span>
            </motion.span>
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
