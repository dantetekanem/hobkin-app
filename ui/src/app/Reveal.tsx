import { motion, type Variants } from 'motion/react'
import type { ReactNode } from 'react'
import { tween } from '@/lib/motion.ts'
import { useStill } from './still.ts'

/**
 * Pieces of a canvas screen that fade in one after another as the screen travels in, so they arrive with it.
 * They share the screen's own variant names (enter, center, exit), so the canvas drives them.
 *
 * They play when the screen mounts (Canvas gives every screen its own entrance). A piece that appears later,
 * after the screen has arrived, would wait for an entrance that already happened and stay hidden: give such
 * a piece its own initial and animate instead.
 */

/**
 * The screen itself travels, left or right, and its pieces only fade in on it: nothing rises from below (the user,
 * 2026-11-24, of coming back from hobkin's mind: "a little down to top move, i want only left/right").
 */
const rise: Variants = {
  enter: { opacity: 0, transform: 'translateY(0px) scale(1)' },
  center: { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: { duration: 0 }, opacity: tween.enter } },
  exit: { opacity: 0, transition: tween.exit },
}

/** The first, largest piece: it fades in as the rest do, and shrinks a little as it leaves. */
const hero: Variants = {
  enter: { opacity: 0, transform: 'translateY(0px) scale(1)' },
  center: { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: { duration: 0 }, opacity: tween.enter } },
  exit: { opacity: 0, transform: 'translateY(0px) scale(0.86)', transition: tween.exit },
}

/**
 * Under Still a piece only fades in: no travel and no growth. Both ends hold it where it rests, so a piece still
 * waiting below when Still was chosen is set straight at once instead of staying small and low.
 */
const still: Variants = {
  enter: { opacity: 0, transform: 'translateY(0px) scale(1)' },
  center: { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: { duration: 0 }, opacity: tween.enter } },
  exit: { opacity: 0, transition: tween.exit },
}

export function Rise({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={useStill() ? still : rise} className={className}>
      {children}
    </motion.div>
  )
}

export function Hero({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={useStill() ? still : hero} className={className}>
      {children}
    </motion.div>
  )
}
