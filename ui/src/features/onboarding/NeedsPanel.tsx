import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { spring, tween } from '@/lib/motion.ts'
import { ConnectPanel } from './ConnectPanel.tsx'
import { NeedsReview } from './NeedsReview.tsx'
import './story.css'

const LANDED = 'translateX(-50%) translateY(0px) scale(1)'

interface NeedsPanelProps {
  /** Where hobkin's feet end, in window pixels. The panel grows up to there, and its list scrolls beyond it. */
  top: number
  onDone: () => void
  /** An install is running, so the story cannot be gone back from. */
  onBusy: (busy: boolean) => void
  still: boolean
}

/**
 * The setup's last look: the review of everything hobkin needs on this Mac, on glass where the Pi panel stands. A
 * missing sign-in hands over to the setup's own sign-in, and the review reads again once it is done or put off.
 */
export function NeedsPanel({ top, onDone, onBusy, still }: NeedsPanelProps) {
  const [signingIn, setSigningIn] = useState(false)
  // Goes up after a sign-in, so the review mounts again and reads again.
  const [round, setRound] = useState(0)
  // An install is running: the story waits for it.
  const [busy, setBusy] = useState(false)
  const primary = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!signingIn) primary.current?.focus({ preventScroll: true })
  }, [signingIn])

  if (signingIn) {
    const back = () => {
      setSigningIn(false)
      setRound((now) => now + 1)
    }
    return <ConnectPanel onDone={back} still={still} />
  }

  const busyNow = (now: boolean) => {
    setBusy(now)
    onBusy(now)
  }

  return (
    <motion.section
      aria-label="What hobkin needs"
      initial={{ opacity: 0, transform: still ? LANDED : 'translateX(-50%) translateY(28px) scale(0.96)' }}
      animate={{ opacity: 1, transform: LANDED, transition: { transform: spring.rise, opacity: tween.enter } }}
      exit={{ opacity: 0, transform: still ? LANDED : 'translateX(-50%) translateY(14px) scale(0.98)', transition: tween.exit }}
      className="tale-glassy tale-glass absolute bottom-[5vh] left-1/2 z-[80] flex w-[min(560px,calc(100vw-48px))] flex-col rounded-3xl p-4"
      style={{ maxHeight: `calc(95vh - ${top}px)` }}
    >
      <NeedsReview key={round} onSignIn={() => setSigningIn(true)} onBusy={busyNow}>
        <Button ref={primary} size="lg" className="min-w-[112px] px-4 text-[14px]" disabled={busy} onClick={onDone}>
          Go on
        </Button>
      </NeedsReview>
    </motion.section>
  )
}
