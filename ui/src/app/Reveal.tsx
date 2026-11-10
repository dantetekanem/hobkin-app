import { motion, type Variants } from 'motion/react'
import type { ReactNode } from 'react'
import { spring, tween } from '@/lib/motion.ts'
import { useStill } from './still.ts'

/**
 * Pieces of a canvas screen that land one after another once the screen has arrived.
 * They share the screen's own variant names (enter, center, exit), so the canvas drives them.
 *
 * They play when the screen mounts (Canvas gives every screen its own entrance). A piece that appears later,
 * after the screen has arrived, would wait for an entrance that already happened and stay hidden: give such
 * a piece its own initial and animate instead.
 */

const rise: Variants = {
  enter: { opacity: 0, transform: 'translateY(26px) scale(0.98)' },
  center: { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.rise, opacity: tween.enter } },
  exit: { opacity: 0, transition: tween.exit },
}

/** The first, largest piece: it pops up from below with more spring than the rest. */
const hero: Variants = {
  enter: { opacity: 0, transform: 'translateY(64px) scale(0.6)' },
  center: { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: { type: 'spring', duration: 0.7, bounce: 0.34 }, opacity: tween.enter } },
  exit: { opacity: 0, transform: 'translateY(0px) scale(0.86)', transition: tween.exit },
}

/** Under Still a piece only fades in: no travel and no growth. */
const still: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: tween.enter },
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
