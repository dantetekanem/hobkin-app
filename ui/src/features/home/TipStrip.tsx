import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Lightbulb, X } from 'lucide-react'
import { Hob } from '@/avatar/Hob.tsx'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { useStill } from '@/features/reports/still.ts'
import { dismiss } from './dismissals.ts'
import { rotationWindow } from './tips.ts'
import type { StripItem } from './types.ts'

/** How many items the strip shows at once, and how long each set holds before the window slides on. */
const VISIBLE = 3
const ROTATE_MS = 9_000

/** One item in the strip: a tip with its key chip, or a hobkin thought with hobkin's own mark so it reads as thinking. */
function Chip({ item, still }: { item: StripItem; still: boolean }) {
  const thought = item.kind === 'thought'
  return (
    <motion.div
      layout={still ? false : 'position'}
      initial={still ? false : { opacity: 0, transform: 'translateY(-8px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)' }}
      exit={still ? { opacity: 0 } : { opacity: 0, transform: 'translateY(8px)' }}
      transition={{ layout: spring.follow, opacity: tween.enter }}
      className={cn(
        'group/tip relative flex min-w-[200px] flex-1 items-start gap-2.5 rounded-xl border px-3 py-2.5 pr-8',
        thought ? 'border-sun/30 bg-sun/[0.06]' : 'border-border bg-surface',
      )}
    >
      {thought ? (
        <Hob mood="idle" still={still} size={24} className="-ml-0.5 shrink-0" />
      ) : (
        <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-md bg-surface-2 text-muted-foreground [&_svg]:size-3.5">
          <Lightbulb />
        </span>
      )}
      <div className="min-w-0 flex-1">
        {thought ? (
          <p className="eyebrow text-sun-fg">hobkin</p>
        ) : item.kbd ? (
          <kbd className="inline-flex rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-foreground">{item.kbd}</kbd>
        ) : null}
        <p className="mt-1 break-words text-[13px] leading-relaxed text-muted-foreground">{item.text}</p>
      </div>
      <button
        type="button"
        aria-label={`Dismiss: ${item.text}`}
        onClick={() => dismiss(item.id)}
        className="absolute right-1 top-1 grid size-6 place-items-center rounded-full text-muted-foreground opacity-0 transition-[opacity,color,background-color] hover:bg-surface-2 hover:text-foreground focus-visible:opacity-100 group-hover/tip:opacity-100"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </motion.div>
  )
}

/**
 * The slim strip at the top of Home: a row of tips and hobkin thoughts that rotates through the whole set over time,
 * so it feels alive, while always showing a few at once. Each item can be dismissed for good. Under reduced motion the
 * set holds still and only ever cross-fades. Renders nothing when there is nothing live to show.
 */
export function TipStrip({ items }: { items: StripItem[] }) {
  const still = useStill()
  const [step, setStep] = useState(0)

  const rotating = !still && items.length > VISIBLE
  useEffect(() => {
    if (!rotating) return
    const timer = setInterval(() => setStep(current => current + 1), ROTATE_MS)
    return () => clearInterval(timer)
  }, [rotating])

  if (!items.length) return null
  const shown = rotationWindow(items, step, VISIBLE)
  return (
    <section aria-label="Tips" className="@container flex flex-wrap gap-3">
      <AnimatePresence mode="popLayout" initial={false}>
        {shown.map(item => <Chip key={item.id} item={item} still={still} />)}
      </AnimatePresence>
    </section>
  )
}
