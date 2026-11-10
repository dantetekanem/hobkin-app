import { motion, type Variants } from 'motion/react'
import { memo } from 'react'
import { cn } from '@/lib/utils.ts'
import { rowLayout } from './list-motion.ts'
import { sourceOf, summaryOf, toneOf, type Report } from './report.ts'
import { clockTime, timeOf } from './time.ts'
import { TONE_TEXT, ToneMark, kindIconOf, warningOf } from './Tone.tsx'

interface ReportRowProps {
  report: Report
  unread: boolean
  /** Its report is in the reader. */
  open: boolean
  variants: Variants
  /** Its turn in the screen's arrival, or -1 when it arrives on its own. */
  order: number
  onOpen: (id: string, from: HTMLElement) => void
}

/**
 * One report in the list: its mark, title and time, what it found, and the routine or project it came from.
 * The row is a stop in the screen's walk, so Up and Down reach it and Enter opens it.
 */
export function ReportRow({ report, unread, open, variants, order, onOpen }: ReportRowProps) {
  return (
    <motion.li layout="position" variants={variants} custom={order} initial="enter" animate="center" exit="gone" transition={rowLayout} className="relative">
      <button
        type="button"
        data-stop=""
        data-report-row={report.id}
        aria-current={open ? 'true' : undefined}
        onClick={(event) => onOpen(report.id, event.currentTarget)}
        className="group relative isolate flex w-full cursor-default items-start gap-3 rounded-2xl px-3 py-2.5 text-left outline-offset-[-2px]"
      >
        {/* The open report's row wears the reader's own color, so the two read as one piece. It lies under the keyboard's ring. */}
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-0 -z-10 rounded-2xl transition-opacity duration-[160ms] ease-[ease]',
            open ? 'bg-background opacity-100' : 'bg-surface-2 opacity-0 group-hover:opacity-60 group-focus-visible:opacity-100',
          )}
        />
        <ReportRowContent report={report} unread={unread} />
      </button>
    </motion.li>
  )
}

// Selection and layout still update the row; unchanged report content need not be rendered again.
const ReportRowContent = memo(function ReportRowContent({ report, unread }: Pick<ReportRowProps, 'report' | 'unread'>) {
  const at = timeOf(report.at)
  const warning = warningOf(report)
  const KindIcon = kindIconOf(report)

  return (
    <>
      <ToneMark tone={toneOf(report)} unread={unread} className="mt-[6px]" />
      <span className="relative min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn('min-w-0 flex-1 truncate font-heading text-[14px] leading-snug tracking-[-0.01em]', unread ? 'font-semibold' : 'font-medium')}>
            {report.title}
          </span>
          {at === null ? null : (
            <time dateTime={new Date(at).toISOString()} className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
              {clockTime(at)}
            </time>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[13px] leading-snug text-muted-foreground">
          {warning ? <span className={cn('font-medium', TONE_TEXT[warning.tone])}>{warning.word}. </span> : null}
          {summaryOf(report)}
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-[11.5px] leading-none text-muted-foreground">
          <KindIcon className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{sourceOf(report)}</span>
        </span>
      </span>
    </>
  )
})

/** A day's heading in the list. It moves with the rows. */
export function DayHeading({ label, variants, order }: { label: string; variants: Variants; order: number }) {
  return (
    <motion.li
      layout="position"
      variants={variants}
      custom={order}
      initial="enter"
      animate="center"
      exit="gone"
      transition={rowLayout}
      className="px-3 pt-4 pb-1 first:pt-1"
    >
      <h3 className="eyebrow">{label}</h3>
    </motion.li>
  )
}
