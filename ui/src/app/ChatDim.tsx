import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import { useSplit } from '@/features/canvas-panel/use-board.ts'
import { useNeedsSignIn } from '@/features/signin/SignInGate.tsx'
import { agentEntry } from '@/features/work/agent-entry.ts'
import { useStill } from './still.ts'
import { spring } from '@/lib/motion.ts'
import { focusInput } from './keys.ts'
import { canvasGrowth, covered, useView } from './view-store.ts'

/**
 * While the canvas has grown over the chat (a review has the user's attention, or a durable hobkin's split has its page
 * where the chat was), the chat steps back: it darkens and blurs a little, in the same movement as the canvas growing.
 * A click on it gives the chat its room back. Once the canvas covers all of the chat, `side` is marked covered.
 */
export function ChatDim({ side }: { side?: RefObject<HTMLElement | null> }) {
  const still = useStill()
  const reviewing = useView((view) => view.screen === 'review' && view.canvasEngaged)
  const split = useSplit() !== null
  const disengageCanvas = useView((view) => view.disengageCanvas)
  const transition = still ? agentEntry(true) : spring.screen
  useCoveredChat(side, still)

  return (
    <AnimatePresence>
      {reviewing || split ? (
        <motion.div key="dim" className="absolute inset-0 z-20" initial="clear" animate="dim" exit="clear" variants={{ clear: {}, dim: {} }}>
          {/* The blur and the darkening are two layers, each animating its own property, so neither pops in. */}
          <motion.div
            data-chat-blur
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

/** How long the canvas takes to grow over the chat, in milliseconds: the spring it grows on (Canvas.tsx). */
const GROW_MS = spring.screen.duration * 1000

/**
 * Marks `side` with `data-covered` while the canvas covers the whole chat (`covered` in view-store.ts), so nothing in it
 * moves and the blur over it goes (globals.css). The mark comes once the canvas has grown, and leaves in the same draw
 * that starts it shrinking, or as soon as the keyboard goes into the chat.
 */
function useCoveredChat(side: RefObject<HTMLElement | null> | undefined, still: boolean) {
  // The canvas's own growth, with the same inputs Canvas.tsx gives it.
  const split = useSplit()
  const needsModel = useNeedsSignIn()
  const splitShown = split !== null && !needsModel
  const growth = useView((view) =>
    canvasGrowth({ screen: view.screen, canvasEngaged: view.canvasEngaged, conversationWidth: view.conversationWidth, proofReturn: view.proofReturn, split: splitShown }),
  )
  const conversationWidth = useView((view) => view.conversationWidth)
  // The growth the canvas has finished growing to. A new growth is not settled until its spring has run.
  const [settledAt, setSettledAt] = useState<number | null>(null)
  const settled = settledAt === growth
  const [chatFocused, setChatFocused] = useState(false)
  const isCovered = covered({ growth, conversationWidth, settled, chatFocused })

  useEffect(() => {
    if (settled) return
    const timer = setTimeout(() => setSettledAt(growth), still ? 0 : GROW_MS)
    return () => clearTimeout(timer)
  }, [growth, settled, still])

  useEffect(() => {
    const element = side?.current
    if (!element) return
    setChatFocused(element.contains(document.activeElement))
    const onFocusIn = () => setChatFocused(true)
    const onFocusOut = (event: FocusEvent) => setChatFocused(element.contains(event.relatedTarget as Node | null))
    element.addEventListener('focusin', onFocusIn)
    element.addEventListener('focusout', onFocusOut)
    return () => {
      element.removeEventListener('focusin', onFocusIn)
      element.removeEventListener('focusout', onFocusOut)
    }
  }, [side])

  useLayoutEffect(() => {
    const element = side?.current
    if (!element) return
    element.toggleAttribute('data-covered', isCovered)
    return () => element.removeAttribute('data-covered')
  }, [side, isCovered])
}
