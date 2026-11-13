import { CircleCheck } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { Markdown } from '@/features/chat/markdown.ts'
import { tween } from '@/lib/motion.ts'
import { useReduced } from '../state/context.tsx'

/**
 * The merge's moment, from the band opening to everything gone, in milliseconds: well within five seconds. Its phases
 * are shares of this one timeline (`rv-merged-*` in review.css), so the band, the word and its sheen stay in step.
 */
const MERGED_MS = 3600
/** How long the confirmation of any other verdict stays, and how long it takes to leave. */
const DONE = { hold: 3400, exit: 400 } as const

/**
 * What a review leaves on screen once its verdict has landed, after the review itself has closed: "Merged!" for a
 * change that was merged, and a short confirmation of what the host did for every other verdict. It is drawn in a
 * root of its own over the whole window, so it outlives the review, and it takes itself off the page when it is done.
 * Nothing in it takes the pointer except the confirmation, whose words can hold a link. A merge says only "Merged!"
 * (the user, 2026-11-12: "I never requested to write any of that"), so its title and message are not shown.
 */
export function celebrate({ kind, message }: { kind: 'tada' | 'done'; title?: string; message: string }): void {
  if (typeof document === 'undefined') return
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const gone = () => {
    root.unmount()
    host.remove()
  }
  root.render(kind === 'tada' ? <Merged onGone={gone} /> : <Done message={message} onGone={gone} />)
}

/**
 * "Merged!" in gold, large, on a dark flat band across the whole width of the window, a little taller than the word
 * (the user, 2026-11-12: "a flat line covering all the width with a small gap in height, opening from the center and
 * moving! animation is critical in hobkin"). The band opens from the middle outwards, the word comes at the screen and
 * lands on it with a splat, springs back and settles as a tada does, with a flash where it hit (the user, 2026-11-13:
 * "it should also splat and get back to the screen, like a tada animated and with shine"), a light runs across the
 * gold, and then all of it fades away together. It is fixed over the window, so nothing on the page moves, and it
 * never takes the pointer. With reduced motion it only fades in and out.
 *
 * Played by CSS on the compositor: the review closes and the next screen draws in the same moment, and the main
 * thread is busy then.
 */
function Merged({ onGone }: { onGone: () => void }) {
  const reduced = useReduced()
  useEffect(() => {
    const gone = setTimeout(onGone, MERGED_MS + 100)
    return () => clearTimeout(gone)
    // Timed once, from when it first shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="rv-merged" data-reduced={reduced} role="status" aria-live="polite" style={{ '--rv-merged-total': `${MERGED_MS}ms` } as CSSProperties}>
      <div className="rv-merged-band" aria-hidden="true" />
      <div className="rv-merged-flash" aria-hidden="true" />
      <p className="rv-merged-word font-heading font-bold">
        Merged!
        {/* The light: a soft window that crosses the word, over a brighter copy of it that stays in place. */}
        <span className="rv-merged-sheen" aria-hidden="true">
          <span className="rv-merged-sheen-window">
            <span className="rv-merged-sheen-text">Merged!</span>
          </span>
        </span>
      </p>
    </div>
  )
}

/** A short confirmation of what the host did, at the bottom of the window. It leaves the way it came. */
function Done({ message, onGone }: { message: string; onGone: () => void }) {
  const reduced = useReduced()
  const [shown, setShown] = useState(true)
  useEffect(() => {
    const leave = setTimeout(() => setShown(false), DONE.hold)
    const gone = setTimeout(onGone, DONE.hold + DONE.exit + 100)
    return () => {
      clearTimeout(leave)
      clearTimeout(gone)
    }
    // Timed once, from when it first shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const away = reduced ? { opacity: 0 } : { opacity: 0, transform: 'translateY(12px)' }
  return (
    <AnimatePresence>
      {shown ? (
        <div key="done" className="pointer-events-none fixed inset-x-0 bottom-6 z-[200] flex justify-center px-6">
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
      ) : null}
    </AnimatePresence>
  )
}
