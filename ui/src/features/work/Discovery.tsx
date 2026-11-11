import { AnimatePresence, motion, type Variants } from 'motion/react'
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { useStill } from '@/app/still.ts'
import { useStops } from '@/app/stops.ts'
import { Button } from '@/components/ui/button.tsx'
import type { WorkState } from '@/lib/host/index.ts'
import { spring } from '@/lib/motion.ts'
import { discoverableProjects } from './projects.ts'
import { ProposalItem } from './Queue.tsx'

/**
 * Discovery: the projects hobkin knows and does not work on, proposed, skipped and dropped. It slides over the Work
 * screen when asked for. Opening it changes nothing: Take it and Skip send hobkin's own `work.proposal` answers,
 * exactly as the rows did on the main screen. Escape closes it and the keyboard goes back to where it was.
 */
export function Discovery({ work, live, variants, onClose }: { work: WorkState; live: boolean; variants: Variants; onClose: () => void }) {
  const still = useStill()
  const panel = useRef<HTMLDivElement | null>(null)
  const back = useRef<HTMLButtonElement | null>(null)
  const waiting = discoverableProjects(work.projects)
  useStops(panel)

  // The keyboard arrives on the way back, and stays in the panel when the row it was on leaves for the tracked list.
  const at = useRef(0)
  useEffect(() => back.current?.focus({ preventScroll: true }), [])
  useEffect(() => {
    const active = document.activeElement
    if (active && active !== document.body) return
    const stops = [...(panel.current?.querySelectorAll<HTMLElement>('[data-stop]') ?? [])]
    stops[Math.min(at.current, stops.length - 1)]?.focus({
      preventScroll: true,
    })
  }, [waiting.length])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const stops = [...(panel.current?.querySelectorAll<HTMLElement>('[data-stop]') ?? [])]
    const index = stops.findIndex((stop) => stop === event.target || stop.contains(event.target as Node))
    if (index >= 0) at.current = index
    // A choice steps back to its row first (the screen's own rule); Escape on a row or the button closes.
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }

  return (
    <motion.div
      ref={panel}
      data-discovery=""
      role="region"
      aria-label="Discover projects"
      onKeyDown={onKeyDown}
      className="scroll-quiet absolute inset-0 z-10 overflow-y-auto bg-background px-6 pt-[96px] pb-20"
      initial={still ? false : { x: '100%' }}
      animate={{ x: 0 }}
      exit={still ? { opacity: 0, transition: { duration: 0 } } : { x: '100%' }}
      transition={still ? { duration: 0 } : spring.sheet}
    >
      <div className="mx-auto flex max-w-[880px] flex-col gap-4">
        <header className="flex flex-col gap-2 px-1">
          <div className="flex flex-wrap items-center gap-3">
            <Button ref={back} variant="outline" size="sm" data-stop="" onClick={onClose}>
              Back to Work
            </Button>
            <h1 className="eyebrow flex items-baseline gap-2">
              Discover projects <span className="tabular-nums">{waiting.length}</span>
            </h1>
          </div>
          <p className="max-w-[72ch] text-[13.5px] leading-relaxed text-muted-foreground">
            Projects hobkin found and is not working on. Looking here changes nothing: a project is worked on only when you take it. Esc goes back.
          </p>
        </header>
        {waiting.length ? (
          <ul className="relative flex flex-col gap-2">
            <AnimatePresence mode="popLayout">
              {waiting.map((project) => (
                <ProposalItem key={project.slug} project={project} live={live} variants={variants} order={-1} />
              ))}
            </AnimatePresence>
          </ul>
        ) : (
          <p className="px-1 text-[13.5px] leading-relaxed text-muted-foreground">Nothing is waiting. Every project hobkin knows is taken.</p>
        )}
      </div>
    </motion.div>
  )
}
