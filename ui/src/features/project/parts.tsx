import type { ReactNode } from 'react'
import { OpenArrow } from '@/components/ui/open-arrow.tsx'
import { SectionHeading } from '@/features/work/parts.tsx'
import { cn } from '@/lib/utils.ts'

/** The small pieces of a project's page. */

export type ChipTone = 'ok' | 'live' | 'warn' | 'quiet' | 'bad'

const TONES: Record<ChipTone, string> = {
  ok: 'bg-ok/15 text-ok-fg',
  live: 'bg-sun/20 text-sun-fg',
  warn: 'bg-warn/15 text-warn-fg',
  quiet: 'bg-surface-2 text-muted-foreground',
  bad: 'bg-bad/15 text-bad-fg',
}

/** A word or three on a colored pill, as the YOLO page's. */
export function Chip({ tone, title, children, className }: { tone: ChipTone; title?: string; children: string; className?: string }) {
  return (
    <span title={title} className={cn('inline-flex h-5 shrink-0 items-center rounded-full px-2 font-heading text-[11px] font-semibold whitespace-nowrap', TONES[tone], className)}>
      {children}
    </span>
  )
}

/** A section of the page: its heading, kept whether or not it holds anything, so the page's shape never changes. */
export function Block({ id, label, count, aside, children }: { id: string; label: string; count?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-label={label} className="flex scroll-mt-24 flex-col gap-2">
      <SectionHeading label={label} count={count}>
        {aside}
      </SectionHeading>
      {children}
    </section>
  )
}

/** What a section with nothing in it says, in one plain line. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-1 text-[13.5px] leading-relaxed text-muted-foreground">{children}</p>
}

const ROW = 'flex min-h-12 w-full items-center gap-3 rounded-2xl bg-background px-3.5 py-2 text-left'

/**
 * A row of the page. Given `onOpen` it is a button that opens what it names: a click, Enter or Space, the hover layer
 * and the open arrow, and a stop of the Up and Down walk. Without, it is a plain row that changes on nothing, with the
 * arrow's room kept so its columns line up with the rows that open.
 */
export function Row({ onOpen, label, mark, className, children }: { onOpen?: () => void; label: string; mark?: Record<`data-${string}`, string>; className?: string; children: ReactNode }) {
  if (!onOpen) {
    return (
      <div role="group" aria-label={label} className={cn(ROW, className)}>
        {children}
        <span aria-hidden="true" className="size-4 shrink-0" />
      </div>
    )
  }
  return (
    <button type="button" data-stop="" {...mark} aria-label={label} onClick={onOpen} className={cn(ROW, 'pressable outline-offset-[-2px]', className)}>
      {children}
      <OpenArrow />
    </button>
  )
}
