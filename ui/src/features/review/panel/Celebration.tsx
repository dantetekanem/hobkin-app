import { CircleCheck } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Hob } from '@/avatar/Hob.tsx'
import { Markdown } from '@/features/chat/markdown.ts'
import { ease, spring, tween } from '@/lib/motion.ts'
import { useReduced } from '../state/context.tsx'

/** How long each moment stays before it leaves, in milliseconds. With its exit, the "Tada!" is gone within five seconds. */
const HOLD = { tada: 3600, calm: 2600, done: 3400 } as const
/** Long enough for the exit to finish before the moment is taken off the page. */
const EXIT = 400

/**
 * What a review leaves on screen once its verdict has landed, after the review itself has closed: a "Tada!" for a
 * change that was merged, and a short confirmation of what the host did for every other verdict. It is drawn in a
 * root of its own over the whole window, so it outlives the review, and it takes itself off the page when it is done.
 * Nothing in it takes the pointer except the confirmation, whose words can hold a link.
 */
export function celebrate({ kind, title, message }: { kind: 'tada' | 'done'; title: string; message: string }): void {
  if (typeof document === 'undefined') return
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  root.render(
    <Moment
      kind={kind}
      title={title}
      message={message}
      onGone={() => {
        root.unmount()
        host.remove()
      }}
    />,
  )
}

function Moment({ kind, title, message, onGone }: { kind: 'tada' | 'done'; title: string; message: string; onGone: () => void }) {
  const reduced = useReduced()
  const [shown, setShown] = useState(true)
  useEffect(() => {
    const hold = kind === 'done' ? HOLD.done : reduced ? HOLD.calm : HOLD.tada
    const leave = setTimeout(() => setShown(false), hold)
    const gone = setTimeout(onGone, hold + EXIT)
    return () => {
      clearTimeout(leave)
      clearTimeout(gone)
    }
    // Timed once, from when it first shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <AnimatePresence>{shown ? kind === 'tada' ? <Tada key="tada" title={title} message={message} reduced={reduced} /> : <Done key="done" message={message} reduced={reduced} /> : null}</AnimatePresence>
}

/**
 * The merge's "Tada!": a card that pops in the middle of the window, its word rising letter by letter, and a burst of
 * confetti from behind it that falls away. With reduced motion it is the same card, fading in and out where it stands.
 */
function Tada({ title, message, reduced }: { title: string; message: string; reduced: boolean }) {
  const still = { opacity: 0 }
  return (
    <div className="pointer-events-none fixed inset-0 z-[200] grid place-items-center p-6">
      {reduced ? null : <Confetti />}
      <motion.div
        role="status"
        aria-live="polite"
        className="rv-moment relative flex w-full max-w-[380px] flex-col items-center gap-2 rounded-[26px] px-7 pt-6 pb-6 text-center"
        initial={reduced ? still : { opacity: 0, transform: 'scale(0.94)' }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, transform: 'scale(1)' }}
        exit={reduced ? { ...still, transition: tween.fade } : { opacity: 0, transform: 'scale(0.97)', transition: tween.exit }}
        transition={reduced ? tween.fade : { transform: spring.alive, opacity: tween.enter }}
      >
        <Hob mood="celebrating" size={76} stage="var(--rv-moment)" still={reduced} />
        <p className="font-heading text-[38px] leading-none font-bold tracking-[-0.03em]">
          <span className="sr-only">Tada!</span>
          {reduced
            ? <span aria-hidden="true">Tada!</span>
            : [...'Tada!'].map((letter, index) => (
                <motion.span
                  key={index}
                  aria-hidden="true"
                  className="inline-block"
                  initial={{ opacity: 0, transform: 'translateY(12px)' }}
                  animate={{ opacity: 1, transform: 'translateY(0px)' }}
                  transition={{ transform: { ...spring.alive, delay: 0.08 + index * 0.045 }, opacity: { ...tween.enter, delay: 0.08 + index * 0.045 } }}
                >
                  {letter}
                </motion.span>
              ))}
        </p>
        <p className="font-heading text-[15px] leading-snug font-semibold text-pretty [overflow-wrap:anywhere]">Merged: {title}</p>
        {message ? <p className="line-clamp-3 text-[13.5px] leading-snug text-pretty text-muted-foreground [overflow-wrap:anywhere]">{message}</p> : null}
      </motion.div>
    </div>
  )
}

/** The theme's own celebration colors. */
const COLORS = ['var(--hb-accent)', 'var(--hb-ok)', 'var(--hb-code)', 'var(--hb-warn)', 'var(--hb-bad)']
const BITS = 44
/** The strong ease-out the app's motion uses, for the burst, and an ease-in for the fall, as gravity pulls. */
const BURST = `cubic-bezier(${ease.out.join(', ')})`
const FALL = 'cubic-bezier(0.55, 0.085, 0.68, 0.53)'

interface Bit {
  color: string
  width: number
  height: number
  round: boolean
  frames: Keyframe[]
  duration: number
  delay: number
}

/** One piece of confetti: out from the middle, mostly upward, then down as it slows and spins, fading as it falls. */
function bitOf(index: number, random: () => number): Bit {
  // Spread all round, with more of it thrown upward.
  const angle = (index / BITS) * Math.PI * 2 + (random() - 0.5) * 0.5
  const distance = 150 + random() * 210
  const x = Math.cos(angle) * distance
  const y = Math.sin(angle) * distance * 0.75 - 90 - random() * 60
  const fall = 170 + random() * 150
  const spin = (random() < 0.5 ? -1 : 1) * (240 + random() * 480)
  const round = random() < 0.3
  return {
    color: COLORS[index % COLORS.length]!,
    width: round ? 7 : 5 + Math.round(random() * 3),
    height: round ? 7 : 9 + Math.round(random() * 5),
    round,
    frames: [
      { transform: 'translate(0px, 0px) rotate(0deg) scale(0.6)', opacity: 1, easing: BURST },
      { transform: `translate(${(x * 0.82).toFixed(1)}px, ${y.toFixed(1)}px) rotate(${(spin * 0.4).toFixed(0)}deg) scale(1)`, opacity: 1, offset: 0.34, easing: FALL },
      { transform: `translate(${x.toFixed(1)}px, ${(y + fall).toFixed(1)}px) rotate(${spin.toFixed(0)}deg) scale(1)`, opacity: 0 },
    ],
    duration: 1500 + random() * 700,
    delay: random() * 140,
  }
}

function Confetti() {
  const layer = useRef<HTMLDivElement>(null)
  const bits = useMemo(() => Array.from({ length: BITS }, (_, index) => bitOf(index, Math.random)), [])
  // Played on the compositor, so the burst stays smooth while the window changes screens under it.
  useLayoutEffect(() => {
    const pieces = [...(layer.current?.children ?? [])] as HTMLElement[]
    const playing = pieces.map((piece, index) => piece.animate(bits[index]!.frames, { duration: bits[index]!.duration, delay: bits[index]!.delay, fill: 'both' }))
    return () => playing.forEach((animation) => animation.cancel())
  }, [bits])
  return (
    <div ref={layer} aria-hidden="true" className="absolute top-1/2 left-1/2">
      {bits.map((bit, index) => (
        <span
          key={index}
          className="absolute block will-change-transform"
          style={{ width: bit.width, height: bit.height, marginLeft: -bit.width / 2, marginTop: -bit.height / 2, background: bit.color, borderRadius: bit.round ? '999px' : '2px' }}
        />
      ))}
    </div>
  )
}

/** A short confirmation of what the host did, at the bottom of the window. It leaves the way it came. */
function Done({ message, reduced }: { message: string; reduced: boolean }) {
  const away = reduced ? { opacity: 0 } : { opacity: 0, transform: 'translateY(12px)' }
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[200] flex justify-center px-6">
      <motion.div
        role="status"
        aria-live="polite"
        className="rv-moment pointer-events-auto flex max-w-[460px] items-start gap-2.5 rounded-2xl px-4 py-3 text-[14px] leading-snug [overflow-wrap:anywhere]"
        initial={away}
        animate={reduced ? { opacity: 1 } : { opacity: 1, transform: 'translateY(0px)' }}
        exit={{ ...away, transition: reduced ? tween.fade : tween.exit }}
        transition={reduced ? tween.fade : tween.enter}
      >
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok-fg" aria-hidden="true" />
        <div className="min-w-0">
          <Markdown text={message || 'Done.'} />
        </div>
      </motion.div>
    </div>
  )
}
