import { motion } from 'motion/react'
import { useStill } from '@/app/still.ts'
import { useView } from '@/app/view-store.ts'
import { cn } from '@/lib/utils.ts'
import type { ProofRunSummary } from '#shared/protocol/proofs.ts'
import { inflowOf, runForCommand, runWords, specFile } from './proof-match.ts'
import './proofs.css'
import { resultOf, type Tone } from './run/run-view.ts'
import { useProofRuns } from './use-proof-run.ts'

const LOOK: Readonly<Record<Tone, { box: string; dot: string; bar: string }>> = {
  live: { box: 'border-sun bg-sun/20', dot: 'pf-pulse bg-sun', bar: 'bg-foreground' },
  ok: { box: 'border-ok-fg bg-ok/15', dot: 'bg-ok-fg', bar: 'bg-ok-fg' },
  bad: { box: 'border-bad-fg bg-bad/15', dot: 'bg-bad-fg', bar: 'bg-bad-fg' },
  warn: { box: 'border-warn-fg bg-warn/15', dot: 'bg-warn-fg', bar: 'bg-warn-fg' },
  quiet: { box: 'border-border bg-surface', dot: 'bg-muted-foreground', bar: 'bg-muted-foreground' },
}

/** The run a `hobkin proof check` started, when the proofs slice has it. */
export function useCheckRun(spec: string, at: number | undefined, output: string): ProofRunSummary | null {
  const { proofs } = useProofRuns()
  return runForCommand(proofs, { spec, ...(at === undefined ? {} : { at }), output })
}

/**
 * An agent's `hobkin proof check`, drawn as the run it started rather than as tool text (050-tla-proofs, screen 4):
 * how it stands in a line, TLC's counts in another, and a bar for how fast new states still come in, never a time
 * left, since TLC cannot know one. Once it ends the bar fills in the result's color and the line under it says what
 * it found. It keeps one height throughout, and opens the run's page.
 */
export function ProofCheckStep({ run, spec }: { run: ProofRunSummary | null; spec: string }) {
  const still = useStill()
  const words = run ? runWords(run) : { title: `Checking ${specFile(spec)}`, detail: 'Waiting for hobkin to start the run', tone: 'live' as const }
  const look = LOOK[words.tone]
  const checking = !run || run.outcome === 'checking'
  const share = !run ? 0 : checking ? inflowOf(run) : 1
  const note = !run || checking ? 'The bar is how fast new states still come in, not a time left: TLC cannot know that.' : resultOf(run).title

  return (
    <div className="flex flex-col gap-2.5">
      <button
        type="button"
        data-step-toggle
        disabled={!run}
        onClick={() => run && useView.getState().openProofRun(run.id)}
        aria-label={`${words.title}. ${words.detail}. Open the proof run.`}
        className={cn('grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] border px-3.5 py-3 text-left transition-colors duration-[160ms] ease-[ease] enabled:hover:brightness-[0.98] disabled:cursor-default', look.box)}
      >
        <span aria-hidden="true" className={cn('size-2.5 rounded-full', look.dot)} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[13px] font-semibold">{words.title}</span>
          <span className="truncate font-mono text-[11.5px] text-muted-foreground tabular-nums">{words.detail}</span>
        </span>
        <span className={cn('text-[12.5px] font-semibold', run ? '' : 'opacity-40')}>Open</span>
      </button>
      <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-tone-1">
        <motion.span
          className={cn('block h-full origin-left rounded-full', look.bar)}
          initial={false}
          animate={{ transform: `scaleX(${Math.min(1, Math.max(0, share))})` }}
          transition={still ? { duration: 0 } : { duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
        />
      </div>
      <p className="truncate text-[12px] text-muted-foreground">{note}</p>
    </div>
  )
}
