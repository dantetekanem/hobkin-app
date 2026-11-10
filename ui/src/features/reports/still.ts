import { useReducedMotionConfig } from 'motion/react'

/**
 * True when nothing should travel: the Movement setting is Still, or it follows the Mac and the Mac asks for
 * less. A piece that travels asks this itself and keeps only its fade, including the reader, which is moved
 * by hand rather than by a component's props.
 */
export function useStill(): boolean {
  return useReducedMotionConfig() ?? false
}
