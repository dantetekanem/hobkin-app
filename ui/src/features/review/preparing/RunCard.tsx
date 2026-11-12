import { ChevronDown, RefreshCw, TriangleAlert } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { useStore } from 'zustand'
import { Button } from '@/components/ui/button.tsx'
import { useNow } from '@/features/chat/use-now.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import type { ReviewLoader } from '../loader.ts'
import { failureOf, preparingOf, underWay } from '../preparing-model.ts'
import { useReduced } from '../state/context.tsx'
import { LiveLog } from './LiveLog.tsx'
import { ProgressLine } from './ProgressLine.tsx'
import './preparing.css'

const CARD = 'pointer-events-auto w-[min(360px,calc(100vw-2rem))] rounded-2xl bg-popover p-4 text-popover-foreground shadow-float'

/**
 * A run over the open review, in the corner where "Refresh review" is: its graph being built again, or its change
 * review, with what it does now, how far along it is, the time, which step of how many, and its log a click away. A run
 * that stopped says why, with "Try again". It goes once the new review is open.
 *
 * Purpose of the motion: the card arrives where the reviewer asked for the rebuild, so it reads as that request's answer.
 */
export function RunCard({ loader }: { loader: ReviewLoader }) {
  const preparation = useStore(loader, (state) => state.preparation)
  const startedAt = useStore(loader, (state) => state.startedAt)
  const reduced = useReduced()
  const running = underWay(preparation)
  const now = useNow(running, 1000)
  const [open, setOpen] = useState(false)
  const arrive = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: tween.enter }
    : { initial: { opacity: 0, transform: 'translateY(-6px) scale(0.98)' }, animate: { opacity: 1, transform: 'translateY(0px) scale(1)' }, transition: { transform: spring.sheet, opacity: tween.enter } }

  if (!running) {
    const failure = failureOf(preparation)
    if (!failure) return null
    return (
      <motion.section {...arrive} aria-label="The last run stopped" data-reduced={reduced} className={CARD}>
        <div className="flex items-start gap-2.5">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-bad-fg" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-heading text-[15px] font-semibold">{preparation?.assessment?.state === 'failed' ? 'The change review stopped' : 'The review could not be built again'}</p>
            <p className="mt-1 text-[14px] leading-snug text-pretty text-muted-foreground [overflow-wrap:anywhere]">{failure}</p>
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="outline" className="text-[14px]" onClick={() => void loader.refresh()}>
            <RefreshCw />
            Try again
          </Button>
        </div>
      </motion.section>
    )
  }

  const view = preparingOf(preparation, startedAt, now)
  const title = preparation?.phase != null ? 'Building the review again' : view.state === 'queued' ? 'Waiting to review the change' : 'Reviewing the change'
  const facts = [view.position ? `Step ${view.position.step} of ${view.position.of}` : null, view.elapsed ? `${view.elapsed} so far` : null, view.left ? `about ${view.left} left` : null].filter(Boolean)
  return (
    <motion.section {...arrive} aria-label={title} data-reduced={reduced} className={CARD}>
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="pv-breath relative size-2.5 shrink-0 rounded-full bg-primary" />
        <p className="min-w-0 flex-1 truncate font-heading text-[15px] font-semibold">{title}</p>
        {view.percent != null ? <span className="font-heading text-[15px] font-semibold tabular-nums">{view.percent}%</span> : null}
      </div>
      <ProgressLine percent={view.percent} state={view.state} label="How far along it is" className="mt-3" />
      <p role="status" aria-live="polite" className="mt-3 line-clamp-2 text-[14px] leading-snug text-pretty [overflow-wrap:anywhere]" title={view.now}>
        {view.now}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[14px] text-muted-foreground tabular-nums">{facts.join(' · ')}</p>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((before) => !before)}
          className="-mr-1.5 flex shrink-0 items-center gap-1 rounded-full px-2 py-1 font-heading text-[14px] font-semibold text-muted-foreground transition-colors duration-[160ms] hover:bg-muted hover:text-foreground"
        >
          Log
          <ChevronDown aria-hidden="true" className={cn('size-4 transition-transform duration-[220ms] ease-[var(--ease-out)]', open && 'rotate-180')} />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div key="log" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tween.enter}>
            <LiveLog lines={view.log} className="mt-3 max-h-[220px] rounded-xl bg-code-bg px-3 py-2.5 text-code-text" />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.section>
  )
}
