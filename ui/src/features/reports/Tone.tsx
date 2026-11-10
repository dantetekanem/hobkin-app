import { CalendarClock, Workflow, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils.ts'
import { kindOf, triageOf, type Report, type ReportKind, type Tone } from './report.ts'

/** Each tone in words, for the eye and for a screen reader. */
export const TONE_NAME: Record<Tone, string> = {
  critical: 'Critical',
  blocked: 'Blocked',
  useful: 'Useful',
  nothing: 'Nothing new',
  plain: 'Report',
}

/** The tones as the conversation colors its notices. */
export const TONE_FILL: Record<Tone, string> = {
  critical: 'bg-bad',
  blocked: 'bg-warn',
  useful: 'bg-ok',
  nothing: 'bg-border-strong',
  plain: 'bg-border-strong',
}

const TONE_RING: Record<Tone, string> = {
  critical: 'border-bad',
  blocked: 'border-warn',
  useful: 'border-ok',
  nothing: 'border-border-strong',
  plain: 'border-border-strong',
}

export const TONE_TEXT: Record<Tone, string> = {
  critical: 'text-bad-fg',
  blocked: 'text-warn-fg',
  useful: 'text-ok-fg',
  nothing: 'text-muted-foreground',
  plain: 'text-muted-foreground',
}

export const KIND_ICON: Record<ReportKind, LucideIcon> = { scheduled: CalendarClock, done: Workflow }
export const KIND_NAME: Record<ReportKind, string> = { scheduled: 'Routine', done: 'Work done' }

const OUTCOME_WORD: Record<string, string> = { failed: 'Failed', incomplete: 'Stopped early', interrupted: 'Interrupted', cancelled: 'Cancelled' }

/** The word a row puts before its summary, when the report needs it said: a problem, or a run that went wrong. */
export function warningOf(report: Report): { word: string; tone: Tone } | null {
  const triage = triageOf(report)
  if (triage?.level === 'critical' || triage?.level === 'blocked') return { word: TONE_NAME[triage.level], tone: triage.level }
  const word = OUTCOME_WORD[report.outcome]
  return word ? { word, tone: report.outcome === 'failed' ? 'critical' : 'blocked' } : null
}

export function kindIconOf(report: Report): LucideIcon {
  return KIND_ICON[kindOf(report)]
}

/**
 * A report's mark: its color is its tone, and it is filled while the report is unread. Reading it empties
 * the mark, the way a letter is opened. A report that found nothing new wears a smaller mark.
 */
export function ToneMark({ tone, unread, className }: { tone: Tone; unread: boolean; className?: string }) {
  const small = tone === 'nothing'
  return (
    <span className={cn('relative grid shrink-0 place-items-center', small ? 'size-[8px]' : 'size-[10px]', className)}>
      <span aria-hidden="true" className={cn('absolute inset-0 rounded-full border-[1.5px]', TONE_RING[tone])} />
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-0 rounded-full transition-[opacity,transform] duration-[220ms] ease-out',
          TONE_FILL[tone],
          unread ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
        )}
      />
      <span className="sr-only">
        {TONE_NAME[tone]}
        {unread ? ', unread' : ''}
      </span>
    </span>
  )
}
