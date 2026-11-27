import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useHost } from '@/lib/host/index.ts'
import { useView } from '@/app/view-store.ts'
import { needsSignInCanvas } from '../chat/availability.ts'
import { spring, tween } from '@/lib/motion.ts'
import { useFirstModelsNote } from './first-models.ts'
import { SignInScreen } from './SignInScreen.tsx'

/**
 * Whether "Connect a model" takes the canvas: a host is connected and Pi can use no model, or a sign-in is under
 * way, such as one hobkin started from the conversation. It also stays while it says what hobkin's first models were
 * set to by a provider connected there (`first-models.ts`).
 */
export function useNeedsSignIn(): boolean {
  const screen = useView((view) => view.screen)
  const needed = useHost((state) => needsSignInCanvas(state, screen))
  const noting = useFirstModelsNote((note) => note.state !== 'idle')
  return needed || noting
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** Where the frame's canvas is in the window right now. */
function useCanvasBox(watching: boolean): Box | null {
  const [box, setBox] = useState<Box | null>(null)

  useEffect(() => {
    const canvas = watching ? document.querySelector<HTMLElement>('main[aria-label="Canvas"]') : null
    if (!canvas) return
    const measure = () => {
      const { left, top, width, height } = canvas.getBoundingClientRect()
      setBox((now) => (now && now.left === left && now.top === top && now.width === width && now.height === height ? now : { left, top, width, height }))
    }
    measure()
    // The canvas moves when the conversation is resized and when the window is.
    const observer = new ResizeObserver(measure)
    observer.observe(canvas)
    observer.observe(document.documentElement)
    return () => observer.disconnect()
  }, [watching])

  return watching ? box : null
}

/**
 * Puts "Connect a model" where the canvas is, until the frame's canvas mounts `SignInScreen` itself.
 * It covers the canvas exactly, so the conversation stays in view beside it.
 */
export function SignInGate() {
  const needed = useNeedsSignIn()
  const box = useCanvasBox(needed)

  return (
    <AnimatePresence>
      {needed && box ? (
        <motion.div
          key="signin"
          className="fixed z-40 bg-background"
          style={box}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: tween.enter }}
          exit={{ opacity: 0, transition: tween.exit }}
        >
          <motion.section
            aria-label="Connect a model"
            // The frame's Command+J moves the keyboard into the canvas. While this covers it, that is here.
            data-canvas-screen
            tabIndex={-1}
            className="h-full overflow-hidden rounded-l-[26px] bg-surface shadow-float outline-none"
            initial={{ transform: 'translateX(48px) scale(0.98)' }}
            animate={{ transform: 'translateX(0px) scale(1)', transition: spring.screen }}
            exit={{ transform: 'translateX(24px) scale(0.99)', transition: tween.exit }}
          >
            <SignInScreen />
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
