import { AnimatePresence, motion } from 'motion/react'
import { useEffect, type CSSProperties } from 'react'
import { Kbd } from '@/components/ui/kbd.tsx'
import { play } from '@/features/sound/index.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { piecesOf } from './story.ts'
import './story.css'

/** When a bubble's words arrive, in milliseconds: the wait before the first one, the gap between them, and one word's own time. The same numbers as `.tale-word` in story.css. */
export const WORDS = { wait: 90, gap: 45, each: 420 }

/** How long a bubble's words take to arrive, in milliseconds. */
export const saidAfter = (line: string): number => WORDS.wait + piecesOf(line).length * WORDS.gap + WORDS.each

interface BubbleProps {
  /** Changes with every bubble, so each one pops in on its own. */
  id: string
  line: string
  /** All its words are up, by time or because the user went on. */
  said: boolean
  /** The story waits for the user to go on, with nothing asked. */
  waits: boolean
  /** The top of hobkin's pet, in the window. The bubble sits on top of it. */
  above: { x: number; y: number }
  still: boolean
}

/** The gap between the pet and the bubble, which the tail points across. */
const GAP = 20

const AT_REST = 'translateX(-50%) translateY(0px) scale(1)'

/**
 * What hobkin says: a speech bubble of frosted glass over its head, so the sky and the mountains show through a
 * little. It grows from its tail, a band of light crosses it once, and its words arrive one after another. It
 * drifts while hobkin waits. A new bubble pops in as the one before it lets go.
 */
export function Bubble({ id, line, said, waits, above, still }: BubbleProps) {
  // With sound on, each word babbles as it arrives. Words that are simply there, said at once or held still, say nothing.
  useEffect(() => {
    if (said || still) return
    const babble = piecesOf(line).map((piece, index) => setTimeout(() => play('talk', { word: piece.text }), WORDS.wait + index * WORDS.gap))
    return () => babble.forEach(clearTimeout)
    // For each new bubble, until it is said.
  }, [id, said, still])

  return (
    // No size of its own: a point above the pet that every bubble hangs from.
    <div aria-hidden="true" className="pointer-events-none absolute z-[80]" style={{ left: above.x, top: above.y - GAP }}>
      <div className="tale-drift">
        <AnimatePresence initial>
          <motion.div
            key={id}
            initial={{ opacity: 0, transform: still ? AT_REST : 'translateX(-50%) translateY(12px) scale(0.9)' }}
            animate={{ opacity: 1, transform: AT_REST, transition: { transform: spring.alive, opacity: tween.enter } }}
            exit={{ opacity: 0, transform: still ? AT_REST : 'translateX(-50%) translateY(-8px) scale(0.98)', transition: tween.exit }}
            style={{ transformOrigin: '50% 100%' }}
            className={cn('tale-glassy absolute bottom-0 left-0 w-max max-w-[min(520px,calc(100vw-48px))]', said && 'tale-said')}
          >
            <div className="tale-glass tale-bubble-body rounded-[28px] px-8 py-5">
              <span className="tale-sheen" />
              <p className="relative text-center font-heading text-[clamp(19px,1.35vw,23px)] leading-[1.4] font-medium tracking-[-0.012em] text-pretty text-foreground">
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
              <span className={cn('tale-next', said && waits ? 'tale-nudge' : 'opacity-0')} />
            </div>
            <span className="tale-bubble-tail" />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
