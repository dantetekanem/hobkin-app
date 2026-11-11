import { ChevronLeft, ChevronRight, Reply, Trash, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { slideVariants } from './slide.ts'
import { SavedRun } from './SavedRun.tsx'
import { watchReportRead } from './store.ts'
import { useStill } from './still.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { cn } from '@/lib/utils.ts'
import { kindOf, plainLine, readerParts, sourceOf, type Report, type Triage, type TriageLevel } from './report.ts'
import { ReportMarkdown } from './ReportMarkdown.tsx'
import { clockTime, dayLabel, timeOf } from './time.ts'
import { KIND_NAME, TONE_NAME, TONE_TEXT, kindIconOf } from './Tone.tsx'

interface ReaderProps {
  report: Report
  /** Which way the last move went: 1 to an older report, from the right, -1 to a newer one, from the left. */
  direction?: number
  /** Its place in the list as it is filtered now, counted from 1. Zero when the filter hides it. */
  at: number
  of: number
  onStep: (delta: 1 | -1) => void
  onClose: () => void
  onReply: () => void
  onDelete?: () => void
}

/**
 * A report, open: a card in the strip beside the week (`slide.ts`). From the week, the whole card slides in. From
 * one report to another the box stays where it is, and only the report inside it slides, the same way and as fast,
 * clipped by the box. Nothing else moves on its own. The box holds the keyboard while it is open.
 */
export function Reader({ report, direction = 0, at, of, onStep, onClose, onReply, onDelete }: ReaderProps) {
  const [saved, setSaved] = useState<string | null>(null)
  useEffect(() => setSaved(null), [report.id])
  useEffect(() => watchReportRead(report.id), [report.id])
  const backToReport = () => {
    setSaved(null)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-reader="${CSS.escape(report.id)}"]`)?.focus({ preventScroll: true }))
  }
  const still = useStill()
  const slides = useMemo(() => slideVariants(still), [still])

  return (
    <div
      data-reader={report.id}
      onKeyDownCapture={event => {
        if (event.key === 'v' && !event.metaKey && !event.ctrlKey && !event.altKey && !(event.target as Element).closest('[data-saved-run]')) {
          event.preventDefault(); event.stopPropagation(); setSaved(report.id)
        }
      }}
      tabIndex={-1}
      role="region"
      aria-label={report.title}
      className="pointer-events-auto absolute inset-0 overflow-hidden rounded-[28px] bg-background outline-none"
    >
      {/* The first report rides in with the box, so it does not slide again inside it. */}
      <AnimatePresence initial={false} custom={direction}>
        <motion.div
          key={report.id}
          data-reader-page={report.id}
          custom={direction}
          variants={slides}
          initial="enter"
          animate="center"
          exit="exit"
          className="scroll-quiet absolute inset-0 overflow-y-auto overscroll-contain px-8 pt-[72px] pb-14 @max-[800px]:px-6"
        >
          <Page report={report} />
          <div className="mx-auto mt-6 max-w-[660px]"><Button variant="outline" size="sm" onClick={() => setSaved(report.id)} title="View saved run (v)">View saved run <Kbd>v</Kbd></Button></div>
        </motion.div>
      </AnimatePresence>
      <Toolbar at={at} of={of} onStep={onStep} onClose={onClose} onReply={onReply} onDelete={onDelete} />
      {saved === report.id ? <SavedRun key={report.id} report={report.id} onBack={backToReport} /> : null}
    </div>
  )
}

function Toolbar({ at, of, onStep, onClose, onReply, onDelete }: Pick<ReaderProps, 'at' | 'of' | 'onStep' | 'onClose' | 'onReply' | 'onDelete'>) {
  return (
    // The buttons are for the mouse. The keys they name do the same from anywhere in the reader.
    <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-linear-to-b from-background from-55% to-transparent px-4 pt-3.5 pb-6">
      <div className="pointer-events-auto flex items-center gap-0.5">
        <StepButton label="Newer report" keys="←" disabled={at <= 1} onClick={() => onStep(-1)}>
          <ChevronLeft />
        </StepButton>
        <StepButton label="Older report" keys="→" disabled={at === 0 || at >= of} onClick={() => onStep(1)}>
          <ChevronRight />
        </StepButton>
        {at > 0 ? (
          <span className="ml-1.5 text-[12px] text-muted-foreground tabular-nums">
            {at} of {of}
          </span>
        ) : null}
      </div>
      <div className="pointer-events-auto ml-auto flex items-center gap-1">
        <Button size="sm" tabIndex={-1} onClick={onReply} title="Reply in chat (r)">
          <Reply aria-hidden="true" />
          Reply in chat
          <Kbd className="bg-primary-foreground/10 text-primary-foreground">r</Kbd>
        </Button>
        <Button variant="ghost" size="sm" tabIndex={-1} onClick={onDelete} disabled={!onDelete} title={onDelete ? 'Delete (Backspace)' : 'Deleting reports is not connected yet'}>
          <Trash aria-hidden="true" />
          Delete
          <Kbd>⌫</Kbd>
        </Button>
        <Button variant="ghost" size="icon-sm" tabIndex={-1} aria-label="Close the report" title="Close (esc)" onClick={onClose}>
          <X aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}

function StepButton({ label, keys, disabled, onClick, children }: { label: string; keys: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button variant="ghost" size="icon-sm" tabIndex={-1} aria-label={label} title={`${label} (${keys})`} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  )
}

const OUTCOME_SAYS: Record<string, string> = {
  completed: 'Finished',
  findings: 'Finished',
  no_change: 'Finished with no change',
  failed: 'Failed',
  incomplete: 'Stopped early',
  interrupted: 'Interrupted',
  cancelled: 'Cancelled',
}

function Page({ report }: { report: Report }) {
  const { triage, markdown } = readerParts(report)
  const at = timeOf(report.at)
  const KindIcon = kindIconOf(report)

  return (
    <article className="mx-auto max-w-[660px]">
      <p className="eyebrow flex items-center gap-1.5">
        <KindIcon className="size-3 shrink-0" aria-hidden="true" />
        {KIND_NAME[kindOf(report)]} · {sourceOf(report)}
      </p>
      <h2 className="mt-2 font-heading text-[26px] leading-[1.15] font-semibold tracking-[-0.022em] text-balance">{report.title}</h2>
      <p className="mt-2 text-[13px] text-muted-foreground">
        {at === null ? 'No time given' : `${dayLabel(at, Date.now())} at ${clockTime(at)}`} · {OUTCOME_SAYS[report.outcome] ?? report.outcome}
      </p>
      {triage ? <TriageBand triage={triage} /> : <OutcomeBand outcome={report.outcome} />}
      {markdown ? (
        <div className="mt-6 text-[15px] leading-relaxed">
          <ReportMarkdown text={markdown} />
        </div>
      ) : null}
    </article>
  )
}

const BAND: Record<TriageLevel, string> = {
  critical: 'bg-bad/12',
  blocked: 'bg-warn/14',
  useful: 'bg-ok/12',
  nothing: 'bg-tone-1',
}

/** What the run said about its own report, as a verdict: how much it matters, what it found, and what to do next. */
function TriageBand({ triage }: { triage: Triage }) {
  return (
    <section aria-label="What the run found" className={cn('mt-5 rounded-2xl px-4 py-3.5', BAND[triage.level])}>
      <p className={cn('eyebrow', TONE_TEXT[triage.level])}>{TONE_NAME[triage.level]}</p>
      {triage.message ? <p className="mt-1 font-heading text-[16px] leading-snug font-semibold tracking-[-0.01em]">{plainLine(triage.message)}</p> : null}
      {triage.next ? (
        <p className="mt-2 flex items-baseline gap-2 text-[14px] leading-snug">
          <span className="eyebrow shrink-0">Next</span>
          <span>{plainLine(triage.next)}</span>
        </p>
      ) : null}
    </section>
  )
}

const OUTCOME_BAND: Record<string, { tone: 'critical' | 'blocked'; says: string }> = {
  failed: { tone: 'critical', says: 'The run failed. What it wrote before it stopped is below.' },
  incomplete: { tone: 'blocked', says: 'The run stopped before it finished. What it did is below.' },
  interrupted: { tone: 'blocked', says: 'The run was interrupted. What it did is below.' },
}

function OutcomeBand({ outcome }: { outcome: string }) {
  const band = OUTCOME_BAND[outcome]
  if (!band) return null
  return (
    <section aria-label="How the run ended" className={cn('mt-5 rounded-2xl px-4 py-3.5', BAND[band.tone])}>
      <p className={cn('eyebrow', TONE_TEXT[band.tone])}>{OUTCOME_SAYS[outcome]}</p>
      <p className="mt-1 text-[14px] leading-snug">{band.says}</p>
    </section>
  )
}
