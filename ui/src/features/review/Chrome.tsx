import { Maximize, RotateCcw } from 'lucide-react'
import { motion, useTransform } from 'motion/react'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { useReduced, useReviewMemory, useRig, useSession, useSessionStore } from './state/context.tsx'
import { Rail } from './story/Rail.tsx'

/** Where the dock rises from. Under reduced motion it only fades in, where it rests. */
const BELOW = 'translateY(26px) scale(0.98)'
const RESTING = 'translateY(0px) scale(1)'

const ROUND = 'rv-float pointer-events-auto grid size-9 place-items-center rounded-full text-foreground transition-transform duration-[140ms] ease-[var(--ease-out)] active:scale-[0.94] [&_svg]:size-4'

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

/**
 * The bottom of the screen: the rail in the middle, the whole-graph button at its side.
 * It rides up on the code panel, and keeps to the middle of what the steps panel leaves uncovered.
 *
 * It is drawn once the review has loaded, after the screen's own entrance has played, so it rises on its own initial
 * and animate. A `Rise` here would wait for that entrance and stay hidden (Reveal.tsx), which hid the step pager.
 */
export function Dock({ room }: { room: number }) {
  const store = useSessionStore()
  const rig = useRig()
  const reduced = useReduced()
  const review = useSession((session) => session.review)
  const moved = useReviewMemory((memory) => Object.keys(memory.of(review).positions).length > 0)
  // One transform on one element carries everything here above the code panel and clear of the steps panel.
  const lift = useTransform(() => `translateX(${rig.side.get() / 2}px) translateY(${-rig.panel.get()}px)`)

  return (
    <motion.div className="pointer-events-none absolute inset-x-0 bottom-0 z-10" style={{ transform: lift }}>
      {/* Only as wide as what the steps panel leaves, so the rail never slides under it. */}
      <div className="mx-auto" style={{ maxWidth: Math.max(240, room) }}>
      <motion.div
        className="flex items-center justify-center gap-2 p-3.5"
        initial={{ opacity: 0, transform: reduced ? RESTING : BELOW }}
        animate={{ opacity: 1, transform: RESTING, transition: { transform: spring.rise, opacity: tween.enter } }}
      >
        <RoundButton label="The whole graph" keys="G" onClick={() => store.getState().leave() || store.getState().refit()}>
          <Maximize />
        </RoundButton>
        <Rail />
        {moved ? (
          <RoundButton label="Put the nodes back" onClick={() => store.getState().resetLayout()}>
            <RotateCcw />
          </RoundButton>
        ) : (
          <span className="size-9 shrink-0" aria-hidden="true" />
        )}
      </motion.div>
      </div>
    </motion.div>
  )
}
