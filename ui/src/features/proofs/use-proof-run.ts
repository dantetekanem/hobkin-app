import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProofRun, ProofRunSummary, ProofsState } from '#shared/protocol/proofs.ts'
import { useNow } from '@/features/chat/use-now.ts'
import { runCommand, useHasHost, useProofs } from '@/lib/host/index.ts'
import { SAMPLE_ELAPSED_MS, SAMPLE_PHASES, SAMPLE_PROOFS, SAMPLE_RUNS, type SamplePhase } from './sample.ts'

/**
 * A proof run for its page (050-tla-proofs): the summary the `proofs` slice keeps live, over the whole run `proof.get`
 * answers, which is asked again while the run checks so its chart and log keep up. Without a host, the sample.
 */

const NO_RUNS: ProofsState = { runs: [] }
/** A run that checks is read whole again at most this often. The slice's counters move in between. */
const REFRESH_MS = 1500

/** The proofs slice, or the sample's with no host, so every surface draws the same runs. */
export function useProofRuns(): { proofs: ProofsState; live: boolean } {
  const live = useHasHost()
  const proofs = useProofs()
  return { proofs: live ? (proofs ?? NO_RUNS) : SAMPLE_PROOFS, live }
}

export interface ShownRun {
  run: ProofRun | null
  live: boolean
  /** The time the page reads its clock at: now while it checks, and a still moment for the sample. */
  now: number
  /** Why the whole run could not be read, when the summary is all there is. */
  problem: string | null
}

/** A run as the slice alone has it, before or without `proof.get`. */
const fromSummary = (summary: ProofRunSummary): ProofRun => ({ ...summary, samples: [], definitions: [], log: [] })

const samplePhaseOf = (id: string | null): SamplePhase | null => SAMPLE_PHASES.find((phase) => SAMPLE_RUNS[phase].id === id) ?? null

/** The run `id` names, or the newest when it names none. */
export function useProofRun(id: string | null): ShownRun {
  const { proofs, live } = useProofRuns()
  const summary = useMemo(() => (id ? proofs.runs.find((run) => run.id === id) : proofs.runs[0]) ?? null, [proofs, id])
  const shownId = summary?.id ?? id
  const [whole, setWhole] = useState<{ id: string; run: ProofRun } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const checking = summary?.outcome === 'checking'
  const asked = useRef(0)

  // Read whole on arriving, again when it ends, and every so often while it checks.
  const outcome = summary?.outcome
  const stats = summary?.stats.generated
  useEffect(() => {
    if (!live || !shownId) return
    const wait = checking ? Math.max(0, asked.current + REFRESH_MS - Date.now()) : 0
    let gone = false
    const timer = setTimeout(() => {
      asked.current = Date.now()
      runCommand('proof.get', { id: shownId })
        .then((run) => {
          if (gone) return
          setWhole({ id: shownId, run })
          setProblem(null)
        })
        .catch((error: unknown) => {
          if (!gone) setProblem(error instanceof Error ? error.message : String(error))
        })
    }, wait)
    return () => {
      gone = true
      clearTimeout(timer)
    }
  }, [live, shownId, checking, outcome, stats])

  const clock = useNow(live && checking, 1000)

  if (!live) {
    // The sample's broken check is the whole example: its counterexample, graph and spec.
    const phase = samplePhaseOf(id) ?? 'broken'
    const run = SAMPLE_RUNS[phase]
    return { run, live, now: Date.parse(run.started) + SAMPLE_ELAPSED_MS[phase], problem: null }
  }
  if (!summary) return { run: whole?.id === id ? whole.run : null, live, now: clock, problem }
  // The slice is newer than the last whole read: its counters, rules and actions win, and its count ends the chart.
  const base = whole?.id === summary.id ? whole.run : fromSummary(summary)
  return { run: { ...base, ...summary, samples: withLatest(base.samples, summary, clock) }, live, now: clock, problem }
}

/** While it checks, the chart ends at the slice's count now, so it moves between whole reads. */
function withLatest(samples: ProofRun['samples'], summary: ProofRunSummary, now: number): ProofRun['samples'] {
  const at = now - Date.parse(summary.started)
  const last = samples.at(-1)
  if (summary.outcome !== 'checking' || Number.isNaN(at) || (last && (last.at >= at || last.distinct > summary.stats.distinct))) return samples
  return [...samples, { at, distinct: summary.stats.distinct }]
}
