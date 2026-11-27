import { useEffect, useState } from 'react'
import type { Transition, Variants } from 'motion/react'
import { spring, stagger, tween } from '@/lib/motion.ts'

/**
 * How rows move in the screens' lists. Each row drives its own arrival (`initial="enter" animate="center"`),
 * because rows come and go long after the screen itself arrived: a filter, an undo, an answer. While the
 * screen is arriving they land one after another, the first with it. Later ones pop in from below at once. A row
 * slides into the place a neighbor left, and leaves by `gone`.
 */

/**
 * Why a row leaves. A delete or an answer is the user's act, so it travels: a delete is set aside to the left,
 * an answer goes on to the right, the way the work goes. A filter only fades.
 */
export type Leaving = 'deleted' | 'answered' | 'filtered'

/** How many rows wait their turn as the screen arrives. The rest land with the last of them. */
const MOST_IN_TURN = 10

const rest = 'translateX(0px) translateY(0px) scale(1)'

/**
 * `center` takes the row's place in the arrival (its `custom`), or -1 for a row that arrives on its own.
 * `gone` takes the reason it leaves, which AnimatePresence hands to a leaving row.
 */
export function rowVariants(still: boolean, resumed = false): Variants {
  return {
    enter: resumed ? { opacity: 1, transform: rest } : { opacity: 0, transform: still ? rest : 'translateX(0px) translateY(18px) scale(0.97)' },
    center: (order: number = -1) => {
      const delay = order < 0 ? 0 : Math.min(order, MOST_IN_TURN) * stagger
      // Under Still both ends hold the row where it rests, so a row caught mid-rise when Still was chosen is set straight at once.
      return { opacity: 1, transform: rest, transition: { transform: still ? { duration: 0 } : { ...spring.rise, delay }, opacity: { ...tween.enter, delay } } }
    },
    gone: (leaving: Leaving = 'filtered') =>
      leaving !== 'filtered' && !still
        ? {
            opacity: 0,
            transform: `translateX(${leaving === 'answered' ? 56 : -44}px) translateY(0px) scale(0.96)`,
            transition: { transform: spring.screenExit, opacity: tween.exit },
          }
        : { opacity: 0, transition: tween.exit },
  }
}

/** A row sliding into the place a neighbor left. */
export const rowLayout: Transition = { layout: spring.sheet }

/** True while the screen is arriving, so its rows know to land in turn. */
export function useArriving(playEntrance = true): boolean {
  const [arriving, setArriving] = useState(playEntrance)
  useEffect(() => {
    if (!arriving) return
    const timer = setTimeout(() => setArriving(false), 1000)
    return () => clearTimeout(timer)
  }, [arriving])
  return arriving
}
