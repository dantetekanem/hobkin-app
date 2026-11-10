import type { Variants } from 'motion/react'
import { spring, tween } from '@/lib/motion.ts'

/**
 * The week and the open report are cards side by side in one strip. Opening a report slides the strip so the
 * report comes in from the list's side, as if it had always been there and simply joined the scene. Going back
 * slides the other way, and moving from one report to the next is the same slide. One fast spring with no bounce,
 * transforms only, and under Still a quick fade.
 *
 * `custom` is the direction: 1 brings the next card in from the right, -1 from the left, 0 leaves it in place
 * (the first card, which arrives with the screen itself).
 */

/** A little more than a card's width, so a gap shows between the two cards while they slide. */
const STRIDE = 104

export function slideVariants(still: boolean): Variants {
  if (still) {
    return {
      enter: { opacity: 0 },
      center: { opacity: 1, transition: tween.fade },
      exit: { opacity: 0, transition: tween.fade },
    }
  }
  return {
    enter: (direction: number) => ({ transform: `translateX(${direction * STRIDE}%)` }),
    center: { transform: 'translateX(0%)', transition: spring.sheet },
    exit: (direction: number) => ({ transform: `translateX(${direction * -STRIDE}%)`, transition: spring.sheet }),
  }
}
