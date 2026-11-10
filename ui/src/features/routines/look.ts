import type { Variants } from 'motion/react'
import { spring, tween } from '@/lib/motion.ts'
import type { Tone } from './words.ts'

/**
 * Values the Routines screen's components share: hues, colour classes, motion. Kept apart from the
 * components so a saved edit to one of them refreshes in place.
 */

const HUES = [262, 200, 86, 20, 320, 150, 40, 290]

/** Each routine keeps one hue for its small hobkin, taken from its id. */
export function hueOf(id: string): number {
  let hash = 0
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return HUES[hash % HUES.length]!
}

const TONE_FILL: Record<Tone, string> = {
  ok: 'bg-ok',
  quiet: 'bg-border-strong',
  warn: 'bg-warn',
  bad: 'bg-bad',
}

export const toneFill = (tone: Tone) => TONE_FILL[tone]

/** The stop attributes of a control, or none while the detail covers it. */
export const stopIf = (walkable: boolean) => (walkable ? { 'data-stop': '', tabIndex: 0 } : { tabIndex: -1 })

/** Groups and rows land one after another when the list changes. */
export const groupVariants: Variants = {
  from: { opacity: 0, transform: 'translateY(18px)' },
  here: { opacity: 1, transform: 'translateY(0px)', transition: { transform: spring.rise, opacity: tween.enter } },
  gone: { opacity: 0, transition: tween.exit },
}

/** A row that joins a list after it is drawn pops up from below. One that leaves sinks and fades. */
export const rowMotion = {
  initial: { opacity: 0, transform: 'translateY(16px) scale(0.97)' },
  animate: { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.alive, opacity: tween.enter } },
  exit: { opacity: 0, transform: 'translateY(8px) scale(0.97)', transition: tween.exit },
}

/** A small piece that changes, such as a state chip: the new one pops in as the old one lifts away. */
export const chipMotion = {
  initial: { opacity: 0, transform: 'translateY(8px) scale(0.96)' },
  animate: { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.alive, opacity: tween.enter } },
  exit: { opacity: 0, transform: 'translateY(-6px) scale(0.96)', transition: tween.exit },
}
