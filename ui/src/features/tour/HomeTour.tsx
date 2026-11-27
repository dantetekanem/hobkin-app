import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { focusInput } from '@/app/keys.ts'
import { useStill } from '@/app/still.ts'
import { Hob } from '@/avatar/Hob.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { play } from '@/features/sound/index.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { resolveTourKey } from './keys.ts'
import { holeOf, holePolygon, placeCard, type Box, type Size } from './place.ts'
import { useTour } from './store.ts'
import { firstReportStep, reportLanded } from './steps.ts'
import { useHost } from '@/lib/host/index.ts'

/**
 * A tour of the app, over the whole window: it dims everything, cuts a soft hole around one part at a time and says
 * in a small card what that part does. Mount it once, inside the frame, and start it with `useTour.getState().start()`.
 * While it is open the frame behind it takes no keyboard and no pointer.
 */
export function HomeTour() {
  const open = useTour((state) => state.open)
  const run = useTour((state) => state.run)
  return createPortal(<AnimatePresence>{open ? <TourLayer key={run} /> : null}</AnimatePresence>, document.body)
}

const CARD_WIDTH = 340

function useWindowSize(): Size {
  const [size, setSize] = useState<Size>(() => ({ width: innerWidth, height: innerHeight }))
  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      setSize({ width: innerWidth, height: innerHeight })
    }
    const onResize = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    addEventListener('resize', onResize)
    return () => {
      removeEventListener('resize', onResize)
      cancelAnimationFrame(frame)
    }
  }, [])
  return size
}

/** The target's box, or null when it is not on the page: hidden, or too narrow a window to show it. */
function measure(selector: string | null): Box | null {
  if (!selector) return null
  const rect = document.querySelector(selector)?.getBoundingClientRect()
  if (!rect || rect.width === 0 || rect.height === 0) return null
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

function TourLayer() {
  const flow = useTour((state) => state.flow)
  const go = useTour((state) => state.go)
  const still = useStill()
  const win = useWindowSize()
  const root = useRef<HTMLDivElement | null>(null)
  const card = useRef<HTMLDivElement | null>(null)
  const next = useRef<HTMLButtonElement | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [cardHeight, setCardHeight] = useState(200)
  // The first stop arrives where it stands. Every stop after it travels.
  const [arrived, setArrived] = useState(false)

  const steps = useTour((state) => state.steps)
  const firstRun = useTour((state) => state.firstRun)
  // The first run's report is named once it lands, whether the tour is on that stop or not yet.
  const landed = useHost((state) => (firstRun ? reportLanded(state.snapshot.reports, firstRun) : false))
  const planned = steps[flow.at]!
  const step = planned.id === 'first-report' && firstRun ? firstReportStep(firstRun, landed) : planned
  const last = flow.at === steps.length - 1

  // The frame stays behind the tour, out of reach, until it ends. Then the keyboard goes home.
  useLayoutEffect(() => {
    const frame = document.getElementById('root')
    frame?.setAttribute('inert', '')
    return () => {
      frame?.removeAttribute('inert')
      requestAnimationFrame(() => focusInput())
    }
  }, [])

  // A stop whose target is not on the page is skipped over, the way the person was going. With nothing found
  // the card sits in the middle with no hole.
  useLayoutEffect(() => {
    const found = measure(step.target)
    if (step.target && !found && (flow.direction === 1 || flow.at > 0)) {
      go(flow.direction === 1 ? 'next' : 'back')
      return
    }
    setBox(found)
  }, [flow.at, flow.direction, step.target, go])

  // The window changed size: measure again, once per burst of resizes.
  useEffect(() => {
    let frame = 0
    const again = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setBox(measure(step.target)))
    }
    addEventListener('resize', again)
    return () => {
      removeEventListener('resize', again)
      cancelAnimationFrame(frame)
    }
  }, [step.target])

  // The card's height depends on its words, so it is read once they are in.
  useLayoutEffect(() => {
    if (card.current) setCardHeight(card.current.offsetHeight)
  }, [flow.at, win.width])

  // With sound on, hobkin says a syllable as each stop arrives.
  useEffect(() => {
    play('talk', { word: step.title })
  }, [flow.at])

  // Next takes the keyboard as each stop arrives.
  useLayoutEffect(() => {
    next.current?.focus({ preventScroll: true })
    setArrived(true)
  }, [flow.at])

  // If the keyboard slips out of the tour (a click on the dim, a closed window), it comes back to Next.
  useEffect(() => {
    const element = root.current
    if (!element) return
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget) return
      requestAnimationFrame(() => {
        if (!element.contains(document.activeElement)) next.current?.focus({ preventScroll: true })
      })
    }
    document.addEventListener('focusout', onFocusOut, true)
    return () => document.removeEventListener('focusout', onFocusOut, true)
  }, [])

  const onKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || !(event.target instanceof Element)) return
    const move = resolveTourKey(
      { key: event.key, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey },
      { pressable: event.target.matches('button, a[href], [role="button"]') },
    )
    if (!move) return
    event.preventDefault()
    go(move)
  }

  const hole = holeOf(box, win)
  const spot = placeCard(box, { width: CARD_WIDTH, height: cardHeight }, win)
  const place = `translateX(${spot.left}px) translateY(${spot.top}px)`
  const clip = holePolygon(hole, win)
  // Still: nothing travels, the hole and the card change place at once and only the words fade.
  const travel = still ? { duration: 0 } : spring.travel
  const cardTransition = arrived
    ? { transform: travel, opacity: tween.enter }
    : { transform: still ? { duration: 0 } : spring.rise, opacity: tween.enter }

  return (
    <motion.div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="A tour of hobkin"
      tabIndex={-1}
      onKeyDownCapture={onKeyDownCapture}
      className="fixed inset-0 z-[45] overflow-hidden text-foreground outline-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={tween.exit}
    >
      {/*
        The dim is one full-window layer clipped by a polygon with the hole cut out of it. Clip-path is the sanctioned
        exception to "only transform and opacity": a hole moved by transform would stretch its rounded corners, and
        animating its width and height would lay the page out. A polygon with the same points always interpolates.
      */}
      <motion.div aria-hidden="true" className="absolute inset-0 bg-black/55" initial={false} animate={{ clipPath: clip }} transition={travel} />

      <motion.div
        ref={card}
        className="absolute left-0 top-0 rounded-2xl border border-border bg-surface p-4 shadow-xl"
        style={{ width: CARD_WIDTH }}
        initial={{ opacity: 0, transform: still ? place : `${place} scale(0.96)` }}
        animate={{ opacity: 1, transform: still ? place : `${place} scale(1)` }}
        transition={cardTransition}
      >
        <motion.div
          key={step.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={tween.enter}
          className="flex gap-3"
        >
          <Hob mood={step.mood} size={44} still={still} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-[15px] font-medium text-foreground">{step.title}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{step.text}</p>
            {step.kbd ? <Kbd className="mt-2">{step.kbd}</Kbd> : null}
          </div>
        </motion.div>

        {/* The dots on a line of their own, so ten stops and three buttons never crowd each other out of the card. */}
        <div className="mt-4 flex flex-col gap-3">
          <Dots at={flow.at} ids={steps.map(({ id }) => id)} still={still} />
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" className="-ml-2" onClick={() => go('end')}>
              Skip tour
            </Button>
            <div className="flex items-center gap-1.5">
              {flow.at > 0 ? (
                <Button variant="outline" size="sm" onClick={() => go('back')}>
                  Back
                </Button>
              ) : null}
              <Button ref={next} size="sm" onClick={() => go('next')}>
                {last ? 'Done' : 'Next'}
              </Button>
            </div>
          </div>
        </div>
      </motion.div>

      <p className="sr-only" aria-live="polite">{`Stop ${flow.at + 1} of ${steps.length}: ${step.title}. ${step.text}`}</p>
    </motion.div>
  )
}

/** One dot for each stop, and a pill that is thrown along them to the stop the tour is on. */
function Dots({ at, ids, still }: { at: number; ids: readonly string[]; still: boolean }) {
  return (
    <div aria-hidden="true" className="flex items-center gap-1.5">
      {ids.map((id, index) => (
        <span key={id} className="relative grid size-1.5 place-items-center">
          <span className={cn('size-1.5 rounded-full bg-border-strong/50')} />
          {index === at ? (
            <motion.span layoutId={still ? undefined : 'tour-dot'} className="absolute h-1.5 w-3.5 rounded-full bg-foreground" transition={spring.pill} />
          ) : null}
        </span>
      ))}
    </div>
  )
}
