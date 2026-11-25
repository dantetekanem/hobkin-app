import { ChevronLeft, ChevronRight } from 'lucide-react'
import { LayoutGroup, motion } from 'motion/react'
import { useMemo } from 'react'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import { spring } from '@/lib/motion.ts'
import { ARROW, turnedArrow } from '../graph/navigate.ts'
import { useReduced, useSession, useSessionStore } from '../state/context.tsx'
import { awayFrom, pagerOf } from './pager.ts'

/** Room for each position, and the most the row of them takes: a long story packs its positions closer, in one row. */
const POSITION = 13
const MOST = 320
const LONG = 32

/**
 * The step pager, in the middle of the bottom of the canvas (the user, 2026-11-12): ‹ and › at its ends, and between
 * them "Step 3 of 6" over a position for every step. The steps seen are filled, the current one is wide and accented,
 * and a click on a position goes straight to its step. The left and right arrows walk it from the keyboard.
 *
 * The current position widens by layout animation, which Motion plays as a transform. spring.pill, the same spring as
 * the pill in the screen menu, so a fast run of key presses carries on from where it is.
 */
export function Rail() {
  const store = useSessionStore()
  const steps = useSession((session) => session.view.story)
  const step = useSession((session) => session.story.step)
  const seen = useSession((session) => session.story.seen)
  const away = useSession((session) => awayFrom(session.story))
  const pending = useSession((session) => session.pendingDigits)
  const flow = useSession((session) => session.view.flow)
  const reduced = useReduced()
  const pager = useMemo(() => pagerOf({ steps, step, seen, away, pending }), [away, pending, seen, step, steps])

  return (
    <nav aria-label="Steps" data-away={away} className="rv-float rv-pager pointer-events-auto min-w-0">
      <PagerArrow label="Previous step" keys={ARROW[turnedArrow('left', flow)]} disabled={!pager.back} onClick={() => store.getState().step(-1)}>
        <ChevronLeft />
      </PagerArrow>
      <div className="rv-pager-middle min-w-0">
        <span className="rv-pager-label" aria-live="polite" aria-label={pending ? undefined : `Step ${step + 1} of ${steps.length}, ${seen.length} seen`}>
          {pending ? (
            // A digit waiting for a second one: the number typed so far, in the accent, until it is taken.
            <span className="rv-pager-typed">{pager.label}</span>
          ) : (
            <>
              Step <b>{step + 1}</b> of {steps.length}
            </>
          )}
        </span>
        <LayoutGroup>
          <ol className="rv-dots" style={{ width: Math.min(MOST, steps.length * POSITION + 12), gap: steps.length > LONG ? 1 : 3 }}>
            {pager.positions.map((position) => (
              <li key={steps[position.index]!.id} className="contents">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <motion.button
                        type="button"
                        layout={!reduced}
                        transition={spring.pill}
                        className="rv-dot"
                        data-current={position.current}
                        data-seen={position.seen}
                        aria-current={position.current ? 'step' : undefined}
                        aria-label={`Step ${position.index + 1}: ${position.title}`}
                        onClick={() => store.getState().goTo(position.index)}
                      />
                    }
                  >
                    {/* The bar is a layout element too, so Motion keeps its round ends round while the position stretches. */}
                    <motion.i layout={!reduced} transition={spring.pill} style={{ borderRadius: 999 }} />
                  </TooltipTrigger>
                  <TooltipContent sideOffset={8}>
                    <span className="text-background/60">{position.index + 1}</span> {position.title}
                  </TooltipContent>
                </Tooltip>
              </li>
            ))}
          </ol>
        </LayoutGroup>
      </div>
      <PagerArrow label="Next step" keys={ARROW[turnedArrow('right', flow)]} disabled={!pager.next} onClick={() => store.getState().step(1)}>
        <ChevronRight />
      </PagerArrow>
    </nav>
  )
}

function PagerArrow({ label, keys, disabled, onClick, children }: { label: string; keys: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="rv-pager-arrow" />}>{children}</TooltipTrigger>
      <TooltipContent sideOffset={8}>
        {label} <Kbd>{keys}</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}
