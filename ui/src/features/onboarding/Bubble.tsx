import { ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { CSSProperties } from 'react'
import { Kbd } from '@/components/ui/kbd.tsx'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { piecesOf } from './story.ts'
import './story.css'

/**
 * How long a bubble's words take to arrive, in milliseconds: the wait before the first one, the gap between them,
 * and the last one's own time. The same numbers as `.tale-word` in story.css.
 */
export const saidAfter = (line: string): number => 90 + piecesOf(line).length * 45 + 420

interface BubbleProps {
  /** Changes with every bubble, so each one pops in on its own. */
  id: string
  line: string
  /** All its words are up, by time or because the user went on. */
  said: boolean
  /** The story waits for the user to go on, with nothing asked. */
  waits: boolean
  /** The tip of hobkin's hood, in the window. The bubble sits on top of it. */
  above: { x: number; y: number }
  still: boolean
}

/** The gap between the hood and the bubble, which the tail points across. */
const GAP = 18

const AT_REST = 'translateX(-50%) translateY(0px) scale(1)'

/**
 * What hobkin says: a speech bubble over its head. It grows from its tail, and its words arrive one after
 * another. A new bubble pops in as the one before it lets go.
 */
export function Bubble({ id, line, said, waits, above, still }: BubbleProps) {
  return (
    // No size of its own: a point above the hood that every bubble hangs from.
    <div aria-hidden="true" className="pointer-events-none absolute z-[80]" style={{ left: above.x, top: above.y - GAP }}>
      <AnimatePresence initial>
        <motion.div
          key={id}
          initial={{ opacity: 0, transform: still ? AT_REST : 'translateX(-50%) translateY(10px) scale(0.94)' }}
          animate={{ opacity: 1, transform: AT_REST, transition: { transform: spring.alive, opacity: tween.enter } }}
          exit={{ opacity: 0, transform: still ? AT_REST : 'translateX(-50%) translateY(-8px) scale(0.98)', transition: tween.exit }}
          style={{ transformOrigin: '50% 100%' }}
          className={cn(
            'absolute bottom-0 left-0 w-max max-w-[min(540px,calc(100vw-48px))] rounded-[26px] border border-border bg-card px-7 py-4 shadow-panel',
            said && 'tale-said',
          )}
        >
          <p className="text-center font-heading text-[19px] leading-[1.38] font-medium tracking-[-0.012em] text-balance text-foreground">
            {piecesOf(line).map((piece, index) => {
              const at = { '--at': index } as CSSProperties
              return (
                // The space is outside the word, so the line can break there.
                <span key={`${index}-${piece.text}`}>
                  {piece.key ? (
                    <Kbd className="tale-word h-6 px-1.5 align-[2px] text-[14px]" style={at}>
                      {piece.text}
                    </Kbd>
                  ) : (
                    <span className="tale-word inline-block" style={at}>
                      {piece.text}
                    </span>
                  )}{' '}
                </span>
              )
            })}
          </p>
          {/* The tail, pointing down at the hood. */}
          <span className="absolute -bottom-[7px] left-1/2 size-3.5 -translate-x-1/2 rotate-45 rounded-[3px] border-r border-b border-border bg-card" />
          <ChevronDown
            className={cn(
              'absolute right-2.5 bottom-1 size-4 text-muted-foreground transition-opacity duration-[220ms] ease-out',
              said && waits ? 'tale-nudge' : 'opacity-0',
            )}
          />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
