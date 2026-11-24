import { motion } from 'motion/react'
import type { KeyboardEvent } from 'react'
import { useStill } from '@/app/still.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import type { ProjectTab } from './project-filter.ts'

/**
 * The GitHub page's quick filter, one quiet row: All, then each project hobkin works on, with how many open pull requests
 * and issues each holds. It narrows the whole page, under both of its tabs. The chosen one is the row's stop in the walk,
 * and Left and Right, Home and End choose another, the keyboard going with it. The pill under the chosen one travels to
 * the next on a spring, and under Still it simply moves. Spec: 024-github.
 */
export function ProjectTabs({ tabs, chosen, onChoose }: { tabs: readonly ProjectTab[]; chosen: ProjectTab; onChoose: (slug: string | null) => void }) {
  const still = useStill()

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, at: number) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.nativeEvent.isComposing) return
    const last = tabs.length - 1
    const keys: Record<string, number> = { ArrowLeft: Math.max(0, at - 1), ArrowRight: Math.min(last, at + 1), Home: 0, End: last }
    const next = keys[event.key]
    if (next === undefined) return
    event.preventDefault()
    const tab = tabs[next]!
    if (tab.slug !== chosen.slug) onChoose(tab.slug)
    event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus({ preventScroll: true })
  }

  return (
    <div role="radiogroup" aria-label="Projects" className="flex max-w-full flex-wrap items-center gap-1">
      {tabs.map((tab, at) => {
        const selected = tab.slug === chosen.slug
        return (
          <button
            key={tab.slug ?? ''}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-stop={selected ? '' : undefined}
            onClick={() => {
              if (!selected) onChoose(tab.slug)
            }}
            onKeyDown={(event) => onKeyDown(event, at)}
            className={cn(
              'relative isolate inline-flex h-8 scroll-mt-[124px] items-center gap-1.5 rounded-full px-3 font-heading text-[13px] font-medium whitespace-nowrap outline-offset-2',
              'transition-colors duration-[160ms] ease-[ease]',
              selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {selected ? <motion.span layoutId={still ? undefined : 'github-project'} className="absolute inset-0 -z-10 rounded-full bg-surface-2" transition={still ? tween.fade : spring.follow} /> : null}
            {tab.label}
            {/* A project with nothing open keeps its place, quietly. */}
            <span className={cn('text-[12px] tabular-nums', tab.count === 0 ? 'font-normal' : 'font-semibold')}>{tab.count}</span>
          </button>
        )
      })}
    </div>
  )
}
