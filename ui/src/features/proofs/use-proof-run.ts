import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProofRun, ProofRunSummary, ProofsState } from '#shared/protocol/proofs.ts'
import { runCommand, useHasHost, useProofs } from '@/lib/host/index.ts'
import { endedRun, rememberEnded } from './ended-runs.ts'
import { SAMPLE_ELAPSED_MS, SAMPLE_PHASES, SAMPLE_PROOFS, SAMPLE_RUNS, type SamplePhase } from './sample.ts'

/**
 * A proof run for its page (050-tla-proofs): the summary the `proofs` slice keeps live, over the whole run `proof.get`
 * answers, which is asked again while the run checks so its chart and log keep up. Without a host, the sample.
 *
 * Nothing is redone while its inputs are the same (053-work-control-room): the run keeps its object while the slice
 * says the same of it, however often the host sends the slice for other runs; it reads no clock, so the page draws
 * nothing for a tick; and a run that ended is read whole once while the app is open.
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
  /** A still moment the page reads the run's time at, for the sample. Null while live: the time text reads the clock. */
  now: number | null
  /** The run is whole: `proof.get` answered, or it is the sample. Before that only the slice's summary is known. */
  complete: boolean
  /** Why the whole run could not be read, when the summary is all there is. */
  problem: string | null
}

/** A run as the slice alone has it, before or without `proof.get`. */
const fromSummary = (summary: ProofRunSummary): ProofRun => ({ ...summary, samples: [], definitions: [], log: [] })

const samplePhaseOf = (id: string | null): SamplePhase | null => SAMPLE_PHASES.find((phase) => SAMPLE_RUNS[phase].id === id) ?? null

/** The same object for the same content: the host sends new objects for every run each time any run moves. */
function useSame<T>(value: T | null): T | null {
  const key = value === null ? '' : JSON.stringify(value)
  // The first value seen with this content stands for every later copy of it.
  return useMemo(() => value, [key])
}

/** The run `id` names, or the newest when it names none. */
export function useProofRun(id: string | null): ShownRun {
  const { proofs, live } = useProofRuns()
  const summary = useSame((id ? proofs.runs.find((run) => run.id === id) : proofs.runs[0]) ?? null)
  const shownId = summary?.id ?? id
  const outcome = summary?.outcome
  const generated = summary?.stats.generated
  const [whole, setWhole] = useState<{ id: string; run: ProofRun } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const lastAsked = useRef(0)

  // Read whole on arriving, again when it ends, and while it checks each time its counts move, at most every REFRESH_MS.
  // A run that ended and was read whole is never asked for again.
  useEffect(() => {
    if (!live || !shownId || endedRun(shownId)) return
    const wait = outcome === 'checking' ? Math.max(0, lastAsked.current + REFRESH_MS - Date.now()) : 0
    let gone = false

    const timer = setTimeout(() => {
      lastAsked.current = Date.now()
      runCommand('proof.get', { id: shownId }).then(
        (run) => {
          if (gone) return
          rememberEnded(run)
          setWhole({ id: shownId, run })
          setProblem(null)
        },
        (error: unknown) => {
          if (gone) return
          setProblem(error instanceof Error ? error.message : String(error))
        },
      )
    }, wait)

    return () => {
      gone = true
      clearTimeout(timer)
    }
  }, [live, shownId, outcome, generated])

  // When the slice's summary last changed: while it checks, the chart ends at its count then, with no clock to read.
  const seenAt = useMemo(() => Date.now(), [summary])

  const shown = useMemo((): { run: ProofRun | null; complete: boolean } => {
    const read = (whole?.id === shownId ? whole.run : null) ?? endedRun(shownId) ?? null
    // A run older than the slice keeps comes from proof.get alone.
    if (!summary) return { run: read, complete: read !== null }
    // The slice is newer than the last whole read: its counters, rules and actions win, and its count ends the chart.
    const base = read ?? fromSummary(summary)
    return { run: { ...base, ...summary, samples: withLatest(base.samples, summary, seenAt) }, complete: read !== null }
  }, [summary, shownId, whole, seenAt])

  if (!live) {
    // The sample's broken check is the whole example: its counterexample, graph and spec.
    const phase = samplePhaseOf(id) ?? 'broken'
    const run = SAMPLE_RUNS[phase]
    return { run, live, now: Date.parse(run.started) + SAMPLE_ELAPSED_MS[phase], complete: true, problem: null }
  }
  return { ...shown, live, now: null, problem }
}

/** While it checks, the chart ends at the slice's count as it came in, so it moves between whole reads. */
function withLatest(samples: ProofRun['samples'], summary: ProofRunSummary, seenAt: number): ProofRun['samples'] {
  if (summary.outcome !== 'checking') return samples

  const at = seenAt - Date.parse(summary.started)
  if (Number.isNaN(at)) return samples

  // A whole read that came after the slice's count already ends the chart.
  const last = samples.at(-1)
  const readSince = last && (last.at >= at || last.distinct > summary.stats.distinct)
  if (readSince) return samples

  return [...samples, { at, distinct: summary.stats.distinct }]
}
