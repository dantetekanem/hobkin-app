import { useMemo, useState } from 'react'
import { useView } from '@/app/view-store.ts'
import { Button } from '@/components/ui/button.tsx'
import { runCommand } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { modelsLine, modelsOnMain } from './proof-match.ts'
import type { Tone } from './run/run-view.ts'
import { useProofRuns } from './use-proof-run.ts'

const TITLE: Readonly<Record<Tone, string>> = { ok: '', live: '', quiet: '', warn: 'text-warn-fg', bad: 'text-bad-fg' }
const SAMPLE = 'This is sample data, so nothing runs.'

/** What hobkin said to the last press, and whether it was a refusal. */
interface Said {
  text: string
  refused: boolean
}

/**
 * A project's models on the YOLO page (050-tla-proofs, screen 4): how its state machines' specs stand on main, and
 * Check models, which runs each again at the project's head. Its title opens the run that broke, or the newest. A
 * project with no model shows nothing: the part does not apply to it. It keeps one height whatever it says.
 */
export function ProjectModels({ slug, live }: { slug: string; live: boolean }) {
  const { proofs } = useProofRuns()
  const runs = useMemo(() => modelsOnMain(proofs, slug), [proofs, slug])
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<Said | null>(null)
  if (!runs.length) return null

  const line = modelsLine(runs)
  const first = runs.find((run) => run.outcome === 'broken') ?? runs[0]!

  const check = async () => {
    if (busy) return
    if (!live) {
      setSaid({ text: SAMPLE, refused: false })
      return
    }
    setBusy(true)
    setSaid(null)
    try {
      // One TLC run at a time on this Mac: hobkin queues each as it comes.
      let last = ''
      for (const run of runs) last = (await runCommand('proof.again', { id: run.id })).message
      setSaid({ text: last, refused: false })
    } catch (error) {
      setSaid({ text: error instanceof Error ? error.message : String(error), refused: true })
    } finally {
      setBusy(false)
    }
  }

  const detail = said?.text ?? line.detail
  return (
    <div className="grid h-[60px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] border border-border bg-tone-2 px-3.5">
      <span className="flex min-w-0 flex-col gap-0.5">
        <button
          type="button"
          data-stop=""
          onClick={() => useView.getState().openProofRun(first.id)}
          className={cn('w-fit max-w-full truncate rounded text-left text-[13px] font-semibold underline-offset-2 hover:underline', TITLE[line.tone])}
        >
          {line.title}
        </button>
        <span role={said?.refused ? 'alert' : undefined} title={detail} className={cn('truncate text-[11.5px]', said ? (said.refused ? 'text-bad-fg' : 'text-muted-foreground') : 'font-mono text-muted-foreground')}>
          {detail}
        </span>
      </span>
      <Button variant="outline" size="sm" data-stop="" disabled={busy} focusableWhenDisabled onClick={() => void check()} className="w-[120px] data-disabled:opacity-50">
        {busy ? 'Starting…' : 'Check models'}
      </Button>
    </div>
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
