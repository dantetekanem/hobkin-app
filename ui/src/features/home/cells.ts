import { createElement, useContext, type ReactNode } from 'react'
import { AnimatePresence, motion, PresenceContext, type Variants } from 'motion/react'
import { spring, tween } from '../../lib/motion.ts'
import { useStill } from '../reports/still.ts'

/** A piece of the dashboard arrives on the screen's stagger, then rides `layout`, so when the order changes it glides. */
const cell: Variants = {
  enter: { opacity: 0, transform: 'translateY(22px) scale(0.98)' },
  center: { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.push, opacity: tween.enter } },
  exit: { opacity: 0, transform: 'translateY(0px) scale(0.96)', transition: tween.exit },
}
const cellStill: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: { opacity: tween.enter } },
  exit: { opacity: 0, transition: tween.exit },
}

/** One widget's place in the grid. It takes the screen's entrance variants, so the screen's stagger plays it in. */
export function WidgetCell({ children }: { children: ReactNode }) {
  const still = useStill()
  return createElement(motion.div, {
    layout: still ? false : 'position',
    variants: still ? cellStill : cell,
    transition: { layout: spring.follow },
    className: 'flex min-w-0 flex-col',
  }, children)
}

/**
 * The grid's own presence, so a dismissed widget leaves and one that turns up later enters by itself. On its first
 * paint it follows the screen around it. A screen that arrives plays its stagger, and the widgets wait for it. The
 * app opening on Home draws the screen in place and plays no entrance, so the widgets are drawn in place too:
 * otherwise they would wait at their entrance for a stagger that never comes, hidden until Home was opened again.
 */
export function WidgetCells({ children }: { children: ReactNode }) {
  const screenEnters = useContext(PresenceContext)?.initial !== false
  return createElement(AnimatePresence, { mode: 'popLayout', initial: screenEnters }, children)
}
