import { AnimatePresence, motion } from 'motion/react'
import { spring } from '@/lib/motion.ts'
import { focusAgentsDock } from './AgentsDock.tsx'
import { focusInput } from './keys.ts'
import { useView } from './view-store.ts'

/**
 * While the canvas has grown over the chat (the user is talking to an agent, or looking at a review),
 * the chat steps back: it darkens and blurs a little, in the same movement as the canvas growing.
 * A click on it gives the chat its room back.
 */
export function ChatDim() {
  const talking = useView((view) => view.agentTalk)
  const reviewing = useView((view) => view.screen === 'review' && view.canvasEngaged)
  const leaveAgentTalk = useView((view) => view.leaveAgentTalk)
  const disengageCanvas = useView((view) => view.disengageCanvas)

  return (
    <AnimatePresence>
      {talking || reviewing ? (
        <motion.div key="dim" className="absolute inset-0 z-20" initial="clear" animate="dim" exit="clear" variants={{ clear: {}, dim: {} }}>
          {/* The blur and the darkening are two layers, each animating its own property, so neither pops in. */}
          <motion.div
            className="absolute inset-0"
            variants={{ clear: { backdropFilter: 'blur(0px)' }, dim: { backdropFilter: 'blur(2.5px)' } }}
            transition={spring.screen}
          />
          <motion.div
            className="absolute inset-0 bg-scrim"
            variants={{ clear: { opacity: 0 }, dim: { opacity: 1 } }}
            transition={spring.screen}
            onClick={() => {
              if (talking) {
                leaveAgentTalk()
                focusAgentsDock()
              } else {
                disengageCanvas()
                focusInput()
              }
            }}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
