import { motion } from 'motion/react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useStill } from '@/app/still.ts'
import { spring, tween } from '@/lib/motion.ts'

export interface PageTab<Value extends string> {
  value: Value
  label: string
  /** Beside the label: how many it holds, or what runs in it. */
  extra?: ReactNode
}

/**
 * A screen's own pages, as tabs under its heading (Work, GitHub). The chosen tab is the row's stop in the walk, and
 * Left and Right, Home and End choose another, the keyboard going with it. Each tab is `<id>-tab-<value>` and controls
 * `<id>-panel-<value>`. The pill under the chosen one travels to the next, and under Still it simply moves.
 */
export function PageTabs<Value extends string>({ id, label, tabs, value, onChoose }: { id: string; label: string; tabs: readonly PageTab<Value>[]; value: Value; onChoose: (value: Value) => void }) {
  const still = useStill()

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, at: number) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.nativeEvent.isComposing) return
    const last = tabs.length - 1
    const keys: Record<string, number> = { ArrowLeft: Math.max(0, at - 1), ArrowRight: Math.min(last, at + 1), Home: 0, End: last }
    const next = keys[event.key]
    if (next === undefined) return
    event.preventDefault()
    const tab = tabs[next]!
    if (tab.value !== value) onChoose(tab.value)
    event.currentTarget.parentElement?.querySelector<HTMLElement>(`[id="${id}-tab-${tab.value}"]`)?.focus({ preventScroll: true })
  }

  return (
    <div role="tablist" aria-label={label} className="flex w-fit max-w-full flex-wrap items-center gap-1 rounded-full bg-tone-1 p-1">
      {tabs.map((tab, at) => {
        const selected = tab.value === value
        return (
          <button
            key={tab.value}
            id={`${id}-tab-${tab.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${id}-panel-${tab.value}`}
            tabIndex={selected ? 0 : -1}
            data-stop={selected ? '' : undefined}
            onClick={() => {
              if (!selected) onChoose(tab.value)
            }}
            onKeyDown={(event) => onKeyDown(event, at)}
            className="relative isolate inline-flex h-9 scroll-mt-[124px] items-center gap-2 rounded-full px-4 font-heading text-[14px] font-medium whitespace-nowrap text-muted-foreground outline-offset-2 transition-colors duration-[160ms] ease-[ease] hover:text-foreground aria-selected:text-foreground"
          >
            {selected ? <motion.span layoutId={still ? undefined : `${id}-tab`} className="absolute inset-0 -z-10 rounded-full bg-background shadow-panel" transition={still ? tween.fade : spring.follow} /> : null}
            {tab.label}
            {tab.extra}
          </button>
        )
      })}
    </div>
  )
}

const COUNT_TONE = { quiet: 'bg-surface-2 text-muted-foreground', live: 'bg-sun/20 text-sun-fg', ok: 'bg-ok/15 text-ok-fg' } as const

/** A count beside a tab's label, in words ("2 running"). `tone` marks one that wants a look: something running, something ready. */
export function TabCount({ children, tone = 'quiet' }: { children: ReactNode; tone?: keyof typeof COUNT_TONE }) {
  return <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-[12.5px] font-semibold whitespace-nowrap tabular-nums ${COUNT_TONE[tone]}`}>{children}</span>
}
