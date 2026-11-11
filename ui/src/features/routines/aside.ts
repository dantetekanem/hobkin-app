import type { TargetAndTransition, Variant } from 'motion/react'

/**
 * A screen that slides aside for a Reports-style card (Routines, Action Items) stays mounted and moves by `animate`,
 * so its scroll and its sky stay as they were. These resolve Reports' own slide for it, and bring a row back into view.
 */

/** A slide's target for a direction, from Reports' `slideVariants`. */
export const slideTo = (variant: Variant | undefined, direction: number) =>
  (typeof variant === 'function' ? variant(direction, {}, {}) : variant) as TargetAndTransition

/**
 * Scrolls `list` so `row` is in view. Focus never does it: the canvas that clips a screen sliding back must not
 * chase the row.
 */
export function reveal(list: HTMLElement | null | undefined, row: HTMLElement | null | undefined): void {
  if (!list || !row) return
  const box = list.getBoundingClientRect()
  const at = row.getBoundingClientRect()
  if (at.top < box.top || at.bottom > box.bottom) list.scrollTop += at.top - box.top - box.height / 3
}
