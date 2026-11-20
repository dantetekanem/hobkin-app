import { useMemo } from 'react'
import { useView } from '@/app/view-store.ts'
import { cn } from '@/lib/utils.ts'
import { chipsOf, runsForItem } from './proof-match.ts'
import './proofs.css'
import type { Tone } from './run/run-view.ts'
import { useProofRuns } from './use-proof-run.ts'

const LOOK: Readonly<Record<Tone, { chip: string; dot: string }>> = {
  ok: { chip: 'border-ok-fg bg-ok/15', dot: 'bg-ok-fg' },
  bad: { chip: 'border-bad-fg bg-bad/15', dot: 'bg-bad-fg' },
  warn: { chip: 'border-warn-fg bg-warn/15', dot: 'bg-warn-fg' },
  live: { chip: 'border-sun bg-sun/20', dot: 'pf-pulse bg-sun' },
  quiet: { chip: 'border-border bg-surface', dot: 'bg-muted-foreground' },
}

/**
 * A finished change's proof (050-tla-proofs, screen 4): whether its model holds or broke, and whether its proof is
 * proved or fails, from the checks hobkin ran itself for its item. Each chip opens its run. A change with no check
 * shows nothing here.
 */
export function ProofChips({ project, item, head }: { project: string; item: string; head: string | null }) {
  const { proofs } = useProofRuns()
  const chips = useMemo(() => chipsOf(runsForItem(proofs, project, item, head), head), [proofs, project, item, head])
  if (!chips.length) return null
  return (
    <ul aria-label="Proof" className="flex flex-wrap gap-2">
      {chips.map((chip) => {
        const look = LOOK[chip.tone]
        return (
          <li key={`${chip.id}:${chip.label}`}>
            <button
              type="button"
              tabIndex={-1}
              data-row-control=""
              title="hobkin ran this check itself. Opens the run."
              onClick={() => useView.getState().openProofRun(chip.id)}
              className={cn('inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[12.5px] whitespace-nowrap text-foreground transition-colors duration-[160ms] ease-[ease] hover:brightness-[0.97]', look.chip)}
            >
              <span aria-hidden="true" className={cn('size-2 rounded-full', look.dot)} />
              {chip.label}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
