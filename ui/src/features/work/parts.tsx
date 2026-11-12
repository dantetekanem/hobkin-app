import { OctagonAlert } from 'lucide-react'
import { motion } from 'motion/react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useStill } from '@/app/still.ts'
import type { Grade } from '@/lib/host/index.ts'
import { spring } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import type { AssessmentStatus } from '#shared/review/assessment.ts'
import { reviewBadge, type BadgeTone } from './review-badge.ts'

/** The small pieces the Work screen's sections share. */

const GRADE_TONE: Record<Grade, string> = {
  P0: 'bg-bad/15 text-bad-fg',
  P1: 'bg-warn/15 text-warn-fg',
  P2: 'bg-surface-2 text-muted-foreground',
  P3: 'bg-surface-2 text-muted-foreground',
}

/** How much a piece of work matters, as hobkin grades it: P0 is the most urgent. */
export function GradeChip({ grade }: { grade: Grade | null }) {
  if (!grade) return null
  return <span className={cn('inline-flex h-5 shrink-0 items-center rounded-full px-1.5 font-heading text-[11px] font-semibold tabular-nums', GRADE_TONE[grade])}>{grade}</span>
}

const BADGE_TONE: Record<BadgeTone, string> = {
  bad: 'bg-bad/15 text-bad-fg',
  warn: 'bg-warn/15 text-warn-fg',
  ok: 'bg-ok/15 text-ok-fg',
  quiet: 'bg-surface-2 text-muted-foreground',
}

/** What the change review found at the change's commit, how far along it is, or why it stopped. A critical finding is marked. */
export function ReviewBadge({ status }: { status: AssessmentStatus | undefined }) {
  const { label, tone, title, critical } = reviewBadge(status)
  return (
    <span title={title} className={cn('inline-flex h-5 items-center gap-1 rounded-full px-2 font-heading text-[11px] font-medium whitespace-nowrap tabular-nums', BADGE_TONE[tone])}>
      {critical ? (
        <>
          <OctagonAlert aria-hidden="true" className="size-3 shrink-0" />
          <span className="sr-only">Critical:</span>
        </>
      ) : null}
      {label}
    </span>
  )
}

/** A section's heading, with how many it holds and anything that belongs beside it. */
export function SectionHeading({ label, count, children }: { label: string; count?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 px-1">
      <h2 className="eyebrow flex items-baseline gap-2">
        {label}
        {count !== undefined ? <span className="tabular-nums">{count}</span> : null}
      </h2>
      {children}
    </div>
  )
}

/**
 * A row of choices, such as a project's priority. Left and Right change the choice, as in any radio group, and the
 * chosen one is the group's stop in the walk. Under Still the pill does not travel between choices.
 */
export function Segmented<Value extends string>({
  label,
  name,
  value,
  options,
  disabled = false,
  onChoose,
}: {
  label: string
  /** Unique on the screen, so each group's pill travels only within it. */
  name: string
  value: Value
  options: readonly { value: Value; label: string }[]
  disabled?: boolean
  onChoose: (value: Value) => void
}) {
  const still = useStill()
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    event.preventDefault()
    const at = options.findIndex((option) => option.value === value)
    const next = options[Math.min(options.length - 1, Math.max(0, at + delta))]!
    if (next.value === value) return
    event.currentTarget.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus()
    onChoose(next.value)
  }

  return (
    <div role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} className="flex w-fit rounded-full bg-tone-1 p-0.5" onKeyDown={onKeyDown}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-value={option.value}
            data-stop={selected ? '' : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!selected) onChoose(option.value)
            }}
            className={cn(
              'relative h-7 scroll-mt-[124px] scroll-mb-6 rounded-full px-3 text-[12.5px] font-medium whitespace-nowrap outline-offset-0',
              'transition-colors duration-[160ms] ease-[ease]',
              selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {selected ? (
              <motion.span layoutId={still ? undefined : `segmented-${name}`} className="absolute inset-0 rounded-full bg-surface-2 shadow-panel" transition={spring.pill} />
            ) : null}
            <span className="relative">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/** A line hobkin said about a place on the screen: what was done, or why it could not be. */
export function SaidLine({ tone, children, className }: { tone: 'done' | 'refused'; children: ReactNode; className?: string }) {
  return (
    <p role={tone === 'refused' ? 'alert' : 'status'} className={cn('text-[13px] leading-snug', tone === 'refused' ? 'text-bad-fg' : 'text-muted-foreground', className)}>
      {children}
    </p>
  )
}
