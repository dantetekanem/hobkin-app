import { Search, X } from 'lucide-react'
import { motion } from 'motion/react'
import type { RefObject } from 'react'
import { Kbd } from '@/components/ui/kbd.tsx'
import { spring } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import type { KindFilter } from './inbox.ts'

export const KINDS: readonly { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'done', label: 'Work done' },
]

/**
 * hobkin's three filters, as one row of choices. The chosen one is the walk's stop, and Left and Right change it
 * (the screen's keys do that, so this only draws and takes clicks).
 */
export function KindChoice({ kind, counts, onChoose }: { kind: KindFilter; counts: Record<KindFilter, number>; onChoose: (kind: KindFilter) => void }) {
  return (
    <div role="radiogroup" aria-label="Which reports" data-kind-filter="" className="flex w-fit max-w-full rounded-full bg-tone-1 p-0.5">
      {KINDS.map((option) => {
        const selected = option.value === kind
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-kind={option.value}
            data-stop={selected ? '' : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChoose(option.value)}
            className={cn(
              'relative flex h-8 items-center gap-1.5 rounded-full px-3 font-heading text-[13px] font-medium whitespace-nowrap outline-offset-0',
              'transition-colors duration-[160ms] ease-[ease]',
              selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {selected ? <motion.span layoutId="reports-kind" className="absolute inset-0 rounded-full bg-surface-2" transition={spring.pill} /> : null}
            <span className="relative">{option.label}</span>
            <span className="relative text-[11px] text-muted-foreground tabular-nums">{counts[option.value]}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Narrows the list to titles that hold the text. `/` puts the keyboard here from anywhere on the screen. */
export function TitleFilter({ value, onChange, field }: { value: string; onChange: (value: string) => void; field: RefObject<HTMLInputElement | null> }) {
  return (
    <label className="flex h-9 min-w-0 items-center gap-2 rounded-full border-[1.5px] border-input bg-background pr-1.5 pl-3 transition-colors duration-[160ms] ease-[ease] focus-within:border-ring">
      <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        ref={field}
        data-stop=""
        data-title-filter=""
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Filter by title"
        aria-label="Filter reports by title"
        spellCheck={false}
        autoComplete="off"
        className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
      />
      {value ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Clear the filter"
          onClick={() => {
            onChange('')
            field.current?.focus()
          }}
          className="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors duration-[160ms] ease-[ease] hover:bg-surface-2 hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : (
        <Kbd className="mr-1 shrink-0">/</Kbd>
      )}
    </label>
  )
}
