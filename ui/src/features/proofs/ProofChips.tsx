import { useMemo } from 'react'
import { cn } from '@/lib/utils.ts'
import type { ModelFact } from '#shared/protocol/work.ts'
import { openRunAmong } from './open-run.ts'
import { chipsOf, factChips, runsForItem, type ProofChip } from './proof-match.ts'
import './proofs.css'
import type { Tone } from './run/run-view.ts'
import { chipRuns } from './siblings.ts'
import { useProofRuns } from './use-proof-run.ts'

const LOOK: Readonly<Record<Tone, { chip: string; dot: string }>> = {
  ok: { chip: 'border-ok-fg bg-ok/15', dot: 'bg-ok-fg' },
  bad: { chip: 'border-bad-fg bg-bad/15', dot: 'bg-bad-fg' },
  warn: { chip: 'border-warn-fg bg-warn/15', dot: 'bg-warn-fg' },
  live: { chip: 'border-sun bg-sun/20', dot: 'pf-pulse bg-sun' },
  quiet: { chip: 'border-border bg-surface', dot: 'bg-muted-foreground' },
}

const CHIP = 'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[12.5px] whitespace-nowrap text-foreground'

interface ProofChipsProps {
  project: string
  item: string
  head: string | null
  /** What hobkin's runs at the change's head say of each model covering it. A hobkin from before them sends none. */
  models?: readonly ModelFact[]
}

/**
 * A finished change's proof (050-tla-proofs, screen 4): whether each model covering it holds or broke at its head, and
 * whether its proof is proved or fails, from the checks hobkin ran itself. A chip with a run opens it. Without hobkin's
 * facts, the newest checks of its item in the proofs slice stand in. A change with no check shows nothing here.
 */
export function ProofChips({ project, item, head, models }: ProofChipsProps) {
  const { proofs } = useProofRuns()
  const chips = useMemo(() => (models ? factChips(models, proofs.runs) : chipsOf(runsForItem(proofs, project, item, head), head)), [models, proofs, project, item, head])
  return <ProofChipList chips={chips} />
}

/**
 * The chips themselves, each with a run opening it. In a Work row its keys reach them (`inRow`); elsewhere, as in a
 * review's panel, Tab does, one under the other when `stacked`, so a chip whose words change never moves the next one.
 */
export function ProofChipList({ chips, inRow = true, stacked = false }: { chips: readonly ProofChip[]; inRow?: boolean; stacked?: boolean }) {
  if (!chips.length) return null
  // Each chip opens its run among the change's others, which J and K then move through.
  const siblings = chipRuns(chips)

  return (
    <ul aria-label="Proof" className={cn('flex gap-2', stacked ? 'flex-col items-start' : 'flex-wrap')}>
      {chips.map(({ id, label, tone }) => {
        const look = LOOK[tone]
        const dot = <span aria-hidden="true" className={cn('size-2 rounded-full', look.dot)} />
        return (
          <li key={`${id}:${label}`}>
            {id ? (
              <button
                type="button"
                {...(inRow ? { tabIndex: -1, 'data-row-control': '' } : { 'data-stop': '' })}
                title="hobkin ran this check itself. Opens the run."
                onClick={() => openRunAmong(id, siblings)}
                className={cn(CHIP, 'transition-colors duration-[160ms] ease-[ease] hover:brightness-[0.97]', look.chip)}
              >
                {dot}
                {label}
              </button>
            ) : (
              <span className={cn(CHIP, look.chip)}>
                {dot}
                {label}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The proof score's evidence when hobkin's own model checks at the change's head wrote it, not the review: its line,
 * marked as hobkin's, and the run it names.
 */
export function ProofCheckLine({ check }: { check: { line: string; run: string } }) {
  return (
    <p className="mt-1 text-[12.5px] leading-snug break-words">
      <span className="text-muted-foreground">Proof score: </span>
      {check.line}
      {' · '}
      <button
        type="button"
        tabIndex={-1}
        data-row-control=""
        title="Opens the run"
        onClick={() => openRunAmong(check.run)}
        className="rounded font-semibold text-ok-fg underline-offset-2 hover:underline"
      >
        hobkin ran this itself
      </button>
    </p>
  )
}
