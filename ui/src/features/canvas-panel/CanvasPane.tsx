import { motion } from 'motion/react'
import { useStill } from '@/app/still.ts'
import { spring, tween } from '@/lib/motion.ts'
import { CanvasView } from './CanvasView.tsx'
import { CANVAS_TOP } from './rules.ts'
import { useArrival } from './use-board.ts'

/**
 * A durable hobkin's canvas in its split (`040-canvas-board`): at the right, the right side's usual width, sliding in
 * from the right edge on the same spring as the page moving over the chat. Under Still it only fades. Its page or
 * drawing starts below the floating menu, which stays where it was, over it.
 */
export function CanvasPane({ owner, width }: { owner: string; width: number }) {
  const still = useStill()
  const arrived = useArrival(spring.screen.duration)

  return (
    <motion.aside
      aria-label="Canvas"
      className="absolute inset-y-0 right-0 overflow-hidden rounded-l-[26px] bg-surface shadow-float"
      style={{ width }}
      initial={still ? { opacity: 0 } : { transform: 'translateX(100%)' }}
      animate={still ? { opacity: 1, transition: tween.enter } : { transform: 'translateX(0%)', transition: spring.screen }}
      exit={still ? { opacity: 0, transition: tween.exit } : { transform: 'translateX(100%)', transition: spring.screenExit }}
    >
      <CanvasView key={owner} owner={owner} arrived={arrived} className="absolute inset-x-0 bottom-0 rounded-bl-[26px]" style={{ top: CANVAS_TOP }} />
    </motion.aside>
  )
}
