import { ChevronRight } from 'lucide-react'
import { useView } from '@/app/view-store.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { cn } from '@/lib/utils.ts'
import '../../proofs/proofs.css'
import type { Tone } from '../../proofs/run/run-view.ts'
import type { ModelRow } from '../story/node-models.ts'

const DOT: Readonly<Record<Tone, string>> = { ok: 'bg-ok-fg', bad: 'bg-bad-fg', warn: 'bg-warn-fg', live: 'pf-pulse bg-sun', quiet: 'bg-muted-foreground' }
const WORDS: Readonly<Record<Tone, string>> = { ok: 'text-foreground', bad: 'text-bad-fg', warn: 'text-warn-fg', live: 'text-foreground', quiet: 'text-muted-foreground' }

/**
 * The change's TLA+ model checks in the panel (050-tla-proofs; the user, 2026-11-21: "i want the TLA+ proof to be
 * accessed from the sidebar, easily"): one row for each model, its file over what TLC said of it at the reviewed head
 * and its states, drawn like the rows that need a look. A row with a run opens it on the proof screen, and T opens the
 * first, whose row shows the key. Each row keeps its height and its place as a check runs and ends.
 */
export function ModelChecks({ rows, heading }: { rows: readonly ModelRow[]; heading: string }) {
  const keyed = rows.find((row) => row.run)?.spec

  return (
    <div className="flex flex-col gap-0.5">
      <h3 className={heading}>TLA+ model checks</h3>
      {/* A narrow panel keeps the key and the arrow and drops "Open run", so the result has the room. */}
      <ul className="@container -mx-2 flex flex-col">
        {rows.map((row) => {
          // The file on one line and what TLC said on the next, so the result and its states always show whole.
          const parts = (
            <>
              <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', DOT[row.tone])} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-mono text-[13px] leading-5">{row.file}</span>
                <span className={cn('truncate text-[14px] leading-5', WORDS[row.tone])}>{row.said}</span>
              </span>
            </>
          )
          const run = row.run
          return (
            <li key={row.spec}>
              {run ? (
                <button
                  type="button"
                  data-stop
                  {...(row.spec === keyed ? { 'data-model-run': '' } : {})}
                  title={`${row.file}: ${row.said}. hobkin ran this check itself. Opens the run.`}
                  onClick={() => useView.getState().openProofRun(run)}
                  className="rv-matter flex h-12 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left"
                >
                  {parts}
                  <span className="flex shrink-0 items-center gap-1 font-heading text-[12.5px] font-semibold text-muted-foreground">
                    <span className="@max-[300px]:hidden">Open run</span>
                    {row.spec === keyed ? <Kbd>T</Kbd> : null}
                    <ChevronRight aria-hidden="true" className="size-3.5" />
                  </span>
                </button>
              ) : (
                <div className="flex h-12 min-w-0 items-center gap-2 px-2" title={`${row.file}: hobkin has no check of this model at the reviewed commit.`}>
                  {parts}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
