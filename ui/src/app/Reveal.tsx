import { motion, type Variants } from 'motion/react'
import type { ReactNode } from 'react'
import { spring, tween } from '@/lib/motion.ts'
import { useStill } from './still.ts'

/**
 * Pieces of a canvas screen that land one after another as the screen travels in, on the screen's own spring, so
 * they arrive with it and stop where they land.
 * They share the screen's own variant names (enter, center, exit), so the canvas drives them.
 *
 * They play when the screen mounts (Canvas gives every screen its own entrance). A piece that appears later,
 * after the screen has arrived, would wait for an entrance that already happened and stay hidden: give such
 * a piece its own initial and animate instead.
 */

const rise: Variants = {
  enter: { opacity: 0, transform: 'translateY(26px) scale(0.98)' },
  center: { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.push, opacity: tween.enter } },
  exit: { opacity: 0, transition: tween.exit },
}

/** The first, largest piece: it rises from further below than the rest. */
const hero: Variants = {
  enter: { opacity: 0, transform: 'translateY(64px) scale(0.96)' },
  center: { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.push, opacity: tween.enter } },
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
