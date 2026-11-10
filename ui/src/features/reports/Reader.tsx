import { ChevronLeft, ChevronRight, Reply, Trash, X } from 'lucide-react'
import { AnimatePresence, motion, useAnimate, usePresence, type Variants } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { dur, ease, spring, staggerDelay, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { kindOf, plainLine, readerParts, sourceOf, type Report, type Triage, type TriageLevel } from './report.ts'
import { ReportMarkdown } from './ReportMarkdown.tsx'
import { useStill } from './still.ts'
import { clockTime, dayLabel, timeOf } from './time.ts'
import { KIND_NAME, TONE_NAME, TONE_TEXT, kindIconOf } from './Tone.tsx'

const REST = 'translateX(0px) translateY(0px) scaleX(1) scaleY(1)'

/** The transform that lays the reader exactly over `from`, measured from where it rests (`to`). Its origin is its top left. */
function flip(from: DOMRect, to: DOMRect): string {
  return `translateX(${from.left - to.left}px) translateY(${from.top - to.top}px) scaleX(${from.width / to.width}) scaleY(${from.height / to.height})`
}

function pageVariants(still: boolean): Variants {
  return {
    from: (direction: 1 | -1) => (still ? { opacity: 0 } : { opacity: 0, transform: `translateX(${direction * 56}px)` }),
    here: { opacity: 1, transform: 'translateX(0px)', transition: { transform: spring.screen, opacity: tween.enter } },
    to: (direction: 1 | -1) =>
      still ? { opacity: 0, transition: tween.exit } : { opacity: 0, transform: `translateX(${direction * -40}px)`, transition: { transform: spring.screenExit, opacity: tween.exit } },
  }
}

interface ReaderProps {
  report: Report
  /** The row or the dot it grows out of. Null when it opens with the screen. */
  origin: DOMRect | null
  /** Which way the last step went: 1 to an older report, -1 to a newer one. */
  direction: 1 | -1
  /** Its place in the list as it is filtered now, counted from 1. Zero when the filter hides it. */
  at: number
  of: number
  onStep: (delta: 1 | -1) => void
  onClose: () => void
  onReply: () => void
  onDelete?: () => void
}

/**
 * A report, open. It grows out of the row that was chosen and goes back into it when it closes. Stepping to
 * the next report slides the page in the direction of the key. The tile itself holds the keyboard, so the
 * page under it can change while the keys go on working.
 */
export function Reader({ report, origin, direction, at, of, onStep, onClose, onReply, onDelete }: ReaderProps) {
  const [scope, animate] = useAnimate<HTMLDivElement>()
  const [isPresent, safeToRemove] = usePresence()
  const still = useStill()
  const pages = useMemo(() => pageVariants(still), [still])
  const grows = origin !== null && !still

  // It grows out of the row. Once, as it opens: moving to another report keeps the tile where it is.
  useLayoutEffect(() => {
    const tile = scope.current
    if (!tile || !origin) return
    // Measured at rest, so a second run (React runs effects twice while developing) starts from the same place.
    tile.style.transform = ''
    if (still) {
      tile.style.opacity = '0'
      void animate(tile, { opacity: 1 }, tween.enter)
      return
    }
    const from = flip(origin, tile.getBoundingClientRect())
    tile.style.transform = from
    tile.style.opacity = '0'
    void animate(tile, { transform: [from, REST], opacity: [0, 1] }, { transform: spring.screen, opacity: tween.enter })
  }, []) // The opening is measured once, from the props it opened with.

  // It goes back into its row as it closes, or falls back where the row is gone.
  useEffect(() => {
    if (isPresent) return
    const tile = scope.current
    if (!tile) {
      safeToRemove()
      return
    }
    const row = document.querySelector<HTMLElement>(`[data-report-row="${CSS.escape(report.id)}"]`)
    const target = row?.getBoundingClientRect()
    const shown = target !== undefined && target.height > 0 && target.bottom > 0 && target.top < innerHeight
    const leaving = still
      ? animate(tile, { opacity: 0 }, tween.exit)
      : shown
        ? animate(
            tile,
            { transform: flip(target, tile.getBoundingClientRect()), opacity: 0 },
            { transform: spring.screenExit, opacity: { duration: dur.base, ease: ease.out, delay: staggerDelay } },
          )
        : animate(tile, { transform: 'translateX(0px) translateY(28px) scaleX(0.96) scaleY(0.96)', opacity: 0 }, { transform: spring.screenExit, opacity: tween.exit })
    void leaving.then(safeToRemove)
  }, [isPresent]) // Only the leaving starts this. The report is the last one shown.

  return (
    <div
      ref={scope}
      data-reader=""
      tabIndex={-1}
      role="region"
      aria-label={report.title}
      className="pointer-events-auto absolute inset-0 origin-top-left overflow-hidden rounded-[28px] bg-background outline-offset-[-2px]"
    >
      {/* While the tile grows its words would be squeezed, so they arrive once it has room. */}
      <motion.div
        className="absolute inset-0"
        initial={grows ? { opacity: 0, transform: 'translateY(14px)' } : false}
        animate={{ opacity: 1, transform: 'translateY(0px)' }}
        transition={{ transform: { ...spring.rise, delay: staggerDelay }, opacity: { ...tween.enter, delay: staggerDelay } }}
      >
        <AnimatePresence initial={false} custom={direction}>
          <motion.div
            key={report.id}
            data-reader-page={report.id}
            custom={direction}
            variants={pages}
            initial="from"
            animate="here"
            exit="to"
            className="scroll-quiet absolute inset-0 overflow-y-auto overscroll-contain px-8 pt-[72px] pb-14 @max-[800px]:px-6"
          >
            <Page report={report} />
          </motion.div>
        </AnimatePresence>
        <Toolbar at={at} of={of} onStep={onStep} onClose={onClose} onReply={onReply} onDelete={onDelete} />
      </motion.div>
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
