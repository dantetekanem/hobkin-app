import { Maximize, RotateCcw } from 'lucide-react'
import { AnimatePresence, motion, useTransform } from 'motion/react'
import { useEffect, useState } from 'react'
import type { Unit } from '#shared/review/assessment.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import type { AskCommand } from './panel/ask.ts'
import { NoteInput } from './panel/notes.tsx'
import { proofRoom } from './proof/beside.ts'
import { useReduced, useReviewMemory, useRig, useSession, useSessionStore } from './state/context.tsx'
import { MODE_KEYS, type ReviewMode } from './story/mode.ts'
import { Rail } from './story/Rail.tsx'

/** How long a word from the review stays before it goes by itself. */
const NOTICE_MS = 2600

/**
 * A short word from the review, such as that every node that needs the reviewer is seen (spec 053): under the frame's
 * menus, in the middle of what the panels leave uncovered, and gone by itself. Each press that asks says it again.
 */
export function Notice() {
  const rig = useRig()
  const notice = useSession((session) => session.notice)
  const [shown, setShown] = useState(notice)
  useEffect(() => {
    if (!notice) return
    setShown(notice)
    const gone = setTimeout(() => setShown(null), NOTICE_MS)
    return () => clearTimeout(gone)
  }, [notice])
  const place = useTransform(() => `translateX(calc(-50% + ${(rig.side.get() + rig.outline.get() - rig.proof.get()) / 2}px))`)
  return (
    <motion.div role="status" className="pointer-events-none absolute top-[120px] left-1/2 z-30" style={{ transform: place }}>
      <AnimatePresence>
        {shown ? (
          <motion.p
            key={shown.key}
            className="rv-float flex h-9 items-center rounded-full px-4 font-heading text-[14px] font-medium whitespace-nowrap"
            initial={{ opacity: 0, transform: 'translateY(-6px) scale(0.98)' }}
            animate={{ opacity: 1, transform: 'translateY(0px) scale(1)', transition: tween.enter }}
            exit={{ opacity: 0, transition: tween.exit }}
          >
            {shown.text}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </motion.div>
  )
}

/** Where the dock rises from. Under reduced motion it only fades in, where it rests. */
const BELOW = 'translateY(26px) scale(0.98)'
const RESTING = 'translateY(0px) scale(1)'

// `pressable` gives the round buttons the hover and pressed layer every row and card that acts has (spec 053).
const ROUND = 'rv-float pressable pointer-events-auto grid size-9 place-items-center rounded-full text-foreground transition-transform duration-[140ms] ease-[var(--ease-out)] active:scale-[0.94] [&_svg]:size-4'

/** A round floating button with its name and key in a tooltip. */
function RoundButton({ label, keys, onClick, children, className }: { label: string; keys?: string; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" aria-label={label} onClick={onClick} className={cn(ROUND, className)} />}>{children}</TooltipTrigger>
      <TooltipContent sideOffset={8}>
        {label} {keys ? <Kbd>{keys}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  )
}

const MODES: { mode: ReviewMode; label: string; tip: string }[] = [
  { mode: 'roam', label: 'Free Roam', tip: 'Move between nodes as you like, with nothing leading. Starts on the whole graph' },
  { mode: 'story', label: 'Story', tip: 'Walk the story step by step. Starts at its first step' },
]

/**
 * "Free Roam | Story" (spec 032): how the review is walked, beside the pager, with each mode's key on it. A click on
 * either, the one on or the other, starts it from the beginning, and the keyboard goes back to the review.
 */
function ModeSwitch() {
  const store = useSessionStore()
  const mode = useSession((session) => session.mode)
  return (
    <div role="group" aria-label="How to walk the review" className="rv-float pointer-events-auto flex h-9 shrink-0 items-center gap-0.5 rounded-full p-1">
      {MODES.map((choice) => (
        <Tooltip key={choice.mode}>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-pressed={mode === choice.mode}
                onClick={(event) => {
                  store.getState().setMode(choice.mode)
                  event.currentTarget.closest<HTMLElement>('[data-rv-root]')?.focus({ preventScroll: true })
                }}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-full px-2.5 font-heading text-[13px] font-semibold whitespace-nowrap transition-[background-color,color] duration-[160ms] ease-[var(--ease-out)]',
                  mode === choice.mode ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              />
            }
          >
            {choice.label}
            <Kbd>{MODE_KEYS[choice.mode]}</Kbd>
          </TooltipTrigger>
          <TooltipContent sideOffset={8}>{choice.tip}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

/**
 * The bottom of the screen: the rail in the middle, the whole-graph button at its side, and under them the review's
 * input, where a comment is written and hobkin asked (`NoteInput`). "Free Roam | Story" leads the row; in Free Roam no
 * step leads, so the rail is not shown. It rides up on the code panel, and keeps to the middle of what the steps panel
 * leaves uncovered.
 *
 * It is drawn once the review has loaded, after the screen's own entrance has played, so it rises on its own initial
 * and animate. A `Rise` here would wait for that entrance and stay hidden (Reveal.tsx), which hid the step pager.
 */
export function Dock({ room, ask, units }: { room: number; ask: AskCommand | null; units?: readonly Unit[] | undefined }) {
  const store = useSessionStore()
  const rig = useRig()
  const reduced = useReduced()
  const review = useSession((session) => session.review)
  const moved = useReviewMemory((memory) => Object.keys(memory.of(review).positions).length > 0)
  const story = useSession((session) => session.mode === 'story')
  // The proof beside the graph takes its width from what is left; one that covers the graph covers this too.
  const proof = useSession((session) => session.proof != null)
  const beside = proof ? proofRoom(room) : null
  const left = beside && !beside.covers ? room - beside.width : room
  // One transform on one element carries everything here above the code panel and clear of the steps panel.
  const lift = useTransform(() => `translateX(${(rig.side.get() + rig.outline.get() - rig.proof.get()) / 2}px) translateY(${-rig.panel.get()}px)`)

  return (
    <motion.div className="pointer-events-none absolute inset-x-0 bottom-0 z-10" style={{ transform: lift }}>
      {/* Only as wide as what the steps panel and the proof leave, so the rail never slides under them. */}
      <div className="mx-auto" style={{ maxWidth: Math.max(240, left) }}>
      <motion.div
        className="flex flex-col items-center gap-2.5 px-3.5 pt-3.5 pb-2"
        initial={{ opacity: 0, transform: reduced ? RESTING : BELOW }}
        animate={{ opacity: 1, transform: RESTING, transition: { transform: spring.rise, opacity: tween.enter } }}
      >
        <div className="flex items-center justify-center gap-2">
          <ModeSwitch />
          <RoundButton label="The whole graph" keys="G" onClick={() => store.getState().leave() || store.getState().refit()}>
            <Maximize />
          </RoundButton>
          {story ? <Rail /> : null}
          {moved ? (
            <RoundButton label="Put the nodes back" onClick={() => store.getState().resetLayout()}>
              <RotateCcw />
            </RoundButton>
          ) : (
            <span className="size-9 shrink-0" aria-hidden="true" />
          )}
        </div>
        <NoteInput ask={ask} units={units} />
      </motion.div>
      </div>
    </motion.div>
  )
}
