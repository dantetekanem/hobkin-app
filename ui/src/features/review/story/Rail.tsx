import { ChevronLeft, ChevronRight } from 'lucide-react'
import { LayoutGroup, motion } from 'motion/react'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import { spring } from '@/lib/motion.ts'
import { useReduced, useSession, useSessionStore } from '../state/context.tsx'

/**
 * The story bar in the middle of the footer: Prev and Next at its ends, and between them one segment per step, in
 * the style of the rail on hobkin.dev. The current segment is wide and accented, and the steps already seen are filled.
 *
 * The segments change width by layout animation, which Motion plays as a transform. spring.pill, the same
 * spring as the pill in the screen menu, so a fast run of key presses carries on from where it is.
 */
export function Rail() {
  const store = useSessionStore()
  const steps = useSession((session) => session.view.story)
  const current = useSession((session) => session.story.step)
  const seen = useSession((session) => session.story.seen)
  const away = useSession((session) => session.story.detour != null || session.story.group != null || session.story.whole)
  const pending = useSession((session) => session.pendingDigits)
  const reduced = useReduced()
  const last = steps.length - 1

  return (
    <nav aria-label="Story" className="rv-float pointer-events-auto flex h-10 w-full max-w-[640px] min-w-0 items-center gap-1 rounded-full px-1.5">
      <RailArrow label="Previous step" keys="←" disabled={current === 0 && !away} onClick={() => store.getState().step(-1)}>
        <ChevronLeft />
        <span>Prev</span>
      </RailArrow>
      <LayoutGroup>
        <ol className="flex min-w-0 flex-1 items-center gap-[5px] px-1">
          {steps.map((step, index) => (
            <li key={step.id} className="contents">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <motion.button
                      type="button"
                      layout={!reduced}
                      transition={spring.pill}
                      className="rv-seg"
                      data-current={index === current}
                      data-seen={seen.includes(step.id)}
                      aria-current={index === current ? 'step' : undefined}
                      aria-label={`Step ${index + 1}: ${step.title}`}
                      onClick={() => store.getState().goTo(index)}
                    />
                  }
                >
                  {/* The bar is a layout element too, so Motion keeps its round ends round while the segment stretches. */}
                  <motion.i layout={!reduced} transition={spring.pill} style={{ borderRadius: 999 }} />
                </TooltipTrigger>
                <TooltipContent sideOffset={8}>
                  <span className="text-background/60">{index + 1}</span> {step.title}
                </TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ol>
      </LayoutGroup>
      <span className="shrink-0 px-1 font-heading text-[13px] font-medium text-muted-foreground tabular-nums" aria-live="polite" aria-label={pending ? undefined : `Step ${current + 1} of ${steps.length}, ${seen.length} seen`}>
        {pending ? (
          // A digit waiting for a second one: the number typed so far, in the accent, until it is taken.
          <span className="rounded-full bg-primary px-1.5 text-primary-foreground">Go to {pending}…</span>
        ) : (
          <>
            <span className="font-semibold text-foreground">{current + 1}</span>
            <span className="opacity-60"> / </span>
            {steps.length}
          </>
        )}
      </span>
      <RailArrow label="Next step" keys="→" disabled={current === last && !away} onClick={() => store.getState().step(1)}>
        <span>Next</span>
        <ChevronRight />
      </RailArrow>
    </nav>
  )
}

function RailArrow({ label, keys, disabled, onClick, children }: { label: string; keys: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className="flex h-7 shrink-0 items-center gap-0.5 rounded-full px-2 font-heading text-[13px] font-medium text-foreground transition-[background-color,transform,opacity] duration-[160ms] ease-[var(--ease-out)] hover:bg-secondary active:scale-[0.96] disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-4"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent sideOffset={8}>
        {label} <Kbd>{keys}</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}
