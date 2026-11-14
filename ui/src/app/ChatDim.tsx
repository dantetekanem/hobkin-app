import { AnimatePresence, motion } from 'motion/react'
import { useSplit } from '@/features/canvas-panel/use-board.ts'
import { agentEntry } from '@/features/work/agent-entry.ts'
import { useStill } from './still.ts'
import { spring } from '@/lib/motion.ts'
import { focusInput } from './keys.ts'
import { useView } from './view-store.ts'

/**
 * While the canvas has grown over the chat (a review has the user's attention, or a durable hobkin's split has its page
 * where the chat was), the chat steps back: it darkens and blurs a little, in the same movement as the canvas growing.
 * A click on it gives the chat its room back.
 */
export function ChatDim() {
  const still = useStill()
  const reviewing = useView((view) => view.screen === 'review' && view.canvasEngaged)
  const split = useSplit() !== null
  const disengageCanvas = useView((view) => view.disengageCanvas)
  const transition = still ? agentEntry(true) : spring.screen

  return (
    <AnimatePresence>
      {reviewing || split ? (
        <motion.div key="dim" className="absolute inset-0 z-20" initial="clear" animate="dim" exit="clear" variants={{ clear: {}, dim: {} }}>
          {/* The blur and the darkening are two layers, each animating its own property, so neither pops in. */}
          <motion.div
            className="absolute inset-0"
            variants={{ clear: { backdropFilter: 'blur(0px)' }, dim: { backdropFilter: still ? 'blur(0px)' : 'blur(2.5px)' } }}
            transition={transition}
          />
          <motion.div
            className="absolute inset-0 bg-scrim"
            variants={{ clear: { opacity: 0 }, dim: { opacity: 1 } }}
            transition={transition}
            onClick={() => {
              disengageCanvas()
              focusInput()
            }}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
