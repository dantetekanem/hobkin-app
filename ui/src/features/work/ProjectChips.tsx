import { memo, type KeyboardEvent } from 'react'
import { cn } from '@/lib/utils.ts'
import type { Chip } from './project-filter.ts'

/**
 * Work's project filter: "All" and one chip for each project with something on the page, with its finished changes
 * waiting. The row has one height whatever it holds and scrolls sideways past its width. It is a radio group like the
 * page's other choices: the chosen chip is its one stop, Left and Right move along it and choose, and pressing the
 * chosen chip again shows All. It is quieter than the rows: small type, no fill but on the chosen one.
 */
export const ProjectChips = memo(function ProjectChips({ chips, value, onChoose }: { chips: readonly Chip[]; value: string | null; onChoose: (slug: string | null) => void }) {
  const options = [{ slug: null as string | null, name: 'All', count: null as number | null }, ...chips]

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!delta || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    event.preventDefault()
    const at = options.findIndex((option) => option.slug === value)
    const next = options[Math.min(options.length - 1, Math.max(0, at + delta))]!
    if (next.slug === value) return
    event.currentTarget.querySelector<HTMLElement>(`[data-slug="${CSS.escape(next.slug ?? '')}"]`)?.focus({ preventScroll: false })
    onChoose(next.slug)
  }

  return (
    <div
      role="radiogroup"
      aria-label="Show one project"
      onKeyDown={onKeyDown}
      className="-mx-1 flex h-9 items-center gap-1 overflow-x-auto overflow-y-hidden px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {options.map((option) => {
        const selected = option.slug === value
        return (
          <button
            key={option.slug ?? 'all'}
            type="button"
            role="radio"
            aria-checked={selected}
            data-slug={option.slug ?? ''}
            data-stop={selected ? '' : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChoose(selected ? null : option.slug)}
            className={cn(
              'inline-flex h-7 shrink-0 scroll-mt-[124px] items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium whitespace-nowrap outline-offset-0 transition-colors duration-[160ms] ease-[ease]',
              selected ? 'bg-surface-2 text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.name}
            {option.count ? <span className="text-[11.5px] font-normal tabular-nums opacity-70">{option.count}</span> : null}
          </button>
        )
      })}
    </div>
  )
})
