import { useState } from 'react'
import { useView } from '@/app/view-store.ts'
import { Button } from '@/components/ui/button.tsx'
import { runCommand } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import type { ModelFact } from '#shared/protocol/work.ts'
import { factRow, factsLine, type FactRow } from './proof-match.ts'
import './proofs.css'
import type { Tone } from './run/run-view.ts'
import { useProofRuns } from './use-proof-run.ts'

const TITLE: Readonly<Record<Tone, string>> = { ok: '', live: '', quiet: '', warn: 'text-warn-fg', bad: 'text-bad-fg' }
const DOT: Readonly<Record<Tone, string>> = { ok: 'bg-ok-fg', live: 'pf-pulse bg-sun', quiet: 'bg-muted-foreground', warn: 'bg-warn-fg', bad: 'bg-bad-fg' }
const SAMPLE = 'This is sample data, so nothing runs.'

/** What hobkin said to the last press, and whether it was a refusal. */
interface Said {
  text: string
  refused: boolean
}

/**
 * A project's models on the YOLO page (050-tla-proofs, screen 4), the readiness part YOLO mode needs to hold: how each
 * state machine's model stands on the default branch, as hobkin's latest run of it says. A model with a run opens it,
 * and can be checked again; one nothing checked offers nothing to press. A project with no model shows nothing: the
 * part does not apply to it.
 */
export function ProjectModels({ models, live }: { models: readonly ModelFact[]; live: boolean }) {
  if (!models.length) return null
  const line = factsLine(models)
  return (
    <div className="flex flex-col gap-1 rounded-[14px] border border-border bg-tone-2 px-3.5 py-2.5">
      <p className={cn('text-[13px] font-semibold', TITLE[line.tone])}>{line.title}</p>
      <ul className="flex flex-col">
        {models.map((fact) => (
          <ModelRow key={fact.spec} row={factRow(fact)} live={live} />
        ))}
      </ul>
    </div>
  )
}

/** One model: its file, which opens its run, how it stands, hobkin's line for it, and Check again where a run can be repeated. */
function ModelRow({ row, live }: { row: FactRow; live: boolean }) {
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<Said | null>(null)

  const checkAgain = async (run: string) => {
    if (busy) return
    if (!live) {
      setSaid({ text: SAMPLE, refused: false })
      return
    }

    setBusy(true)
    setSaid(null)
    try {
      setSaid({ text: (await runCommand('proof.again', { id: run })).message, refused: false })
    } catch (error) {
      setSaid({ text: error instanceof Error ? error.message : String(error), refused: true })
    } finally {
      setBusy(false)
    }
  }

  const detail = said?.text ?? row.line
  const run = row.run
  return (
    <li className="grid h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
      <span className="flex min-w-0 items-center gap-2 text-[12.5px]">
        <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', DOT[row.tone])} />
        {run ? (
          <button type="button" data-stop="" title="Opens the run" onClick={() => useView.getState().openProofRun(run)} className="shrink-0 rounded font-mono font-medium underline-offset-2 hover:underline">
            {row.file}
          </button>
        ) : (
          <span className="shrink-0 font-mono font-medium">{row.file}</span>
        )}
        <span className="sr-only">{row.state}.</span>
        <span role={said?.refused ? 'alert' : undefined} title={detail} className={cn('min-w-0 truncate', said?.refused ? 'text-bad-fg' : 'text-muted-foreground')}>
          {detail}
        </span>
      </span>
      {run ? (
        <Button variant="outline" size="sm" data-stop="" disabled={busy} focusableWhenDisabled aria-label={`Check ${row.file} again`} onClick={() => void checkAgain(run)} className="w-[112px] data-disabled:opacity-50">
          {busy ? 'Starting…' : 'Check again'}
        </Button>
      ) : null}
    </li>
  )
}

/**
 * The one press that gets the model checker, shown only once the host says TLC is missing: it downloads the pinned
 * `tla2tools.jar` into hobkin's home and checks it. The user's click is the yes. Without Java, it says so and offers
 * nothing to press.
 */
export function ProofSetup({ live }: { live: boolean }) {
  const { proofs } = useProofRuns()
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<Said | null>(null)
  const tools = proofs.tools
  if (!tools || tools.tlc !== null) return null

  const setUp = async () => {
    if (busy) return
    if (!live) {
      setSaid({ text: SAMPLE, refused: false })
      return
    }
    setBusy(true)
    setSaid(null)
    try {
      setSaid({ text: (await runCommand('proof.setup')).message, refused: false })
    } catch (error) {
      setSaid({ text: error instanceof Error ? error.message : String(error), refused: true })
    } finally {
      setBusy(false)
    }
  }

  const words = tools.java ? 'Model checks need TLC. Set up downloads the pinned tla2tools.jar into hobkin’s home and checks it.' : 'Model checks need Java 11 or newer, and this Mac has none. hobkin installs nothing by itself.'
  return (
    <div className="grid min-h-[60px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl bg-surface px-4 py-2.5">
      <p role={said?.refused ? 'alert' : undefined} className={cn('line-clamp-2 text-[12.5px] leading-[18px]', said?.refused ? 'text-bad-fg' : 'text-muted-foreground')}>
        {said?.text ?? words}
      </p>
      {tools.java ? (
        <Button variant="outline" size="sm" data-stop="" disabled={busy} focusableWhenDisabled onClick={() => void setUp()} className="w-[120px] data-disabled:opacity-50">
          {busy ? 'Setting up…' : 'Set up TLC'}
        </Button>
      ) : null}
    </div>
  )
}
