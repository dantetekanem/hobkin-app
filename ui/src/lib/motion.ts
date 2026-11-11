/**
 * Every motion value in the app lives here, so the feel can be tuned in one place.
 * See _specs/000-product/design.md, "Motion".
 *
 * Rules these values serve:
 * - Only transform, opacity and filter move. Color changes for theme only.
 * - Use full transform strings with Motion (`transform: "translateX(8px)"`), which stay on the compositor.
 * - Nothing enters from scale(0). Entrances start at 0.96 and transparent.
 * - Springs for anything the user can interrupt or reverse.
 */
import type { Transition } from 'motion/react'

/** Strong curves. Built-in CSS easings are too weak for deliberate movement. */
export const ease = {
  out: [0.23, 1, 0.32, 1],
  inOut: [0.77, 0, 0.175, 1],
  drawer: [0.32, 0.72, 0, 1],
} as const

/** Seconds. Small feedback stays under 0.3. Things that travel (screens, the camera, panels) take longer and ride springs. */
export const dur = {
  press: 0.14,
  fast: 0.16,
  base: 0.22,
  panel: 0.4,
  travel: 0.65,
  color: 0.45,
} as const

export const spring = {
  /** Indicators that follow a selection: tab pill, sidebar section pill. No bounce. */
  follow: { type: 'spring', duration: 0.32, bounce: 0 },
  /** Panels and sheets. Carries velocity when a drag or a second key press interrupts it. */
  sheet: { type: 'spring', duration: 0.42, bounce: 0 },
  /** The camera and things it carries. */
  travel: { type: 'spring', duration: 0.65, bounce: 0 },
  /** Small playful things: the avatar, a node arriving. */
  alive: { type: 'spring', duration: 0.45, bounce: 0.18 },
  /** Something large arriving: a sheet, the canvas growing over the chat. It settles, and a new target mid-flight retargets it. */
  screen: { type: 'spring', duration: 0.62, bounce: 0.14 },
  /** Something large leaving. Quicker than an arrival, so what comes next leads. */
  screenExit: { type: 'spring', duration: 0.5, bounce: 0 },
  /**
   * Switching canvas screens: the arriving screen pushes the leaving one off the canvas. Both ride this one spring,
   * side by side, and stop where they land, with no overshoot. A new target mid-flight retargets them.
   */
  push: { type: 'spring', duration: 0.42, bounce: 0 },
  /** The pill that follows the open menu item. A little overshoot makes it feel thrown. */
  pill: { type: 'spring', duration: 0.5, bounce: 0.22 },
  /** A piece of a screen rising into place after the screen arrives. */
  rise: { type: 'spring', duration: 0.6, bounce: 0.2 },
} as const satisfies Record<string, Transition>

export const tween = {
  enter: { duration: dur.base, ease: ease.out },
  exit: { duration: dur.fast, ease: ease.out },
  move: { duration: dur.base, ease: ease.inOut },
  fade: { duration: dur.fast, ease: 'linear' },
} as const satisfies Record<string, Transition>

/** Delay between siblings entering together, and the wait before the first one, so pieces land after their screen. */
export const stagger = 0.055
export const staggerDelay = 0.12
