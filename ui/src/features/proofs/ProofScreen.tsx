import { useMemo, useRef, useState } from 'react'
import { SCREEN_COLUMN, SCREEN_SCROLLER } from '@/app/screen-layout.ts'
import { useStill } from '@/app/still.ts'
import { useStops } from '@/app/stops.ts'
import { useView } from '@/app/view-store.ts'
import { Hob } from '@/avatar/Hob.tsx'
import type { Mood } from '@/avatar/moods.tsx'
import { Button } from '@/components/ui/button.tsx'
import { useViewer } from '@/features/viewer/store.ts'
import { PageTabs, type PageTab } from '@/features/work/PageTabs.tsx'
import { useWorkView } from '@/features/work/store.ts'
import { runCommand, useHost } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import type { ProofRun } from '#shared/protocol/proofs.ts'
import type { RunSummary } from '#shared/protocol/snapshot.ts'
import { itemTitle, placeOf, specFile } from './proof-match.ts'
import './proofs.css'
import { RunView, type ProofTab } from './run/RunView.tsx'
import { controlOf, phaseOf, type Tone } from './run/run-view.ts'
import { useProofRun } from './use-proof-run.ts'

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

/** The tabs this build has. The state graph and the math join once their views are built. */
const TABS: readonly PageTab<ProofTab>[] = [{ value: 'run', label: 'Run' }]

/**
 * A TLA+ proof run, a page of its own (050-tla-proofs), opened from a finished card, an agent's step or the YOLO page:
 * where it belongs and its item's title, how it stands, the one control that stops or runs it again, and its tabs.
 * Escape and Back return to where it was opened from. Without a host it shows the sample check.
 */
export function ProofScreen() {
  const root = useRef<HTMLDivElement | null>(null)
  useStops(root)
  const id = useView((view) => view.openProof)
  const { run, live, now, problem } = useProofRun(id)
  const [tab, setTab] = useState<ProofTab>('run')

  return (
    <div ref={root} className={SCREEN_SCROLLER}>
      <div className={`${SCREEN_COLUMN} @container flex flex-col gap-5 pb-20`}>
        {run ? (
          <>
            <Header run={run} live={live} />
            <PageTabs id="proof" label="Proof run views" tabs={TABS} value={tab} onChoose={setTab} />
            <div role="tabpanel" id={`proof-panel-${tab}`} aria-labelledby={`proof-tab-${tab}`}>
              <RunPanel run={run} now={now} />
            </div>
            {problem ? <p className="text-[12px] text-muted-foreground">Only the latest counts show: {problem}</p> : null}
          </>
        ) : (
          <>
            <BackRow />
            <p className="text-[13.5px] text-muted-foreground">{problem ?? 'This proof run is not among the ones hobkin keeps.'}</p>
          </>
        )}
        {live ? null : <p className="text-[12px] text-muted-foreground">Sample data. No host is running, so nothing here reaches hobkin.</p>}
      </div>
    </div>
  )
}

const MOOD: Readonly<Record<Tone, Mood>> = { live: 'working', ok: 'happy', bad: 'confused', warn: 'focused', quiet: 'idle' }
const DOT: Readonly<Record<Tone, string>> = { live: 'pf-pulse bg-sun', ok: 'bg-ok-fg', bad: 'bg-bad-fg', warn: 'bg-warn-fg', quiet: 'bg-muted-foreground' }

/** Where the run belongs and its title, how it stands, and Stop or Run again, then Back. The two buttons keep their width. */
function Header({ run, live }: { run: ProofRun; live: boolean }) {
  const still = useStill()
  const { work } = useWorkView()
  const agents = useHost((state) => state.snapshot.runs)
  const title = useMemo(() => itemTitle(run, work, agents ?? []), [run, work, agents]) ?? `The model in ${specFile(run.spec)}`
  const phase = phaseOf(run)
  const control = controlOf(run)
  const [said, setSaid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const press = async () => {
    if (busy) return
    if (!live) {
      setSaid('This is sample data, so nothing runs.')
      return
    }
    setBusy(true)
    setSaid(null)
    try {
      const answer = await runCommand(control.command, { id: run.id })
      // Run again starts a new run: its page follows it when hobkin names it.
      const next = 'id' in answer ? answer.id : undefined
      if (next) useView.getState().openProofRun(next)
      else setSaid(answer.message)
    } catch (error) {
      setSaid(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <header className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Hob mood={MOOD[phase.tone]} size={42} still={still} className="shrink-0" />
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-0.5">
          <p className="eyebrow">{placeOf(run, work)}</p>
          <h1 title={title} className="line-clamp-1 font-heading text-[24px] leading-tight font-semibold tracking-[-0.02em]">
            {title}
          </h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="inline-flex h-8 items-center gap-2 rounded-full border border-border bg-surface px-3 text-[13px] whitespace-nowrap">
            <span aria-hidden="true" className={cn('size-2 rounded-full', DOT[phase.tone])} />
            {phase.label}
          </span>
          <Button variant="outline" data-stop="" disabled={busy} focusableWhenDisabled onClick={() => void press()} className="h-9 w-[112px] rounded-xl text-[13.5px]">
            {control.label}
          </Button>
          <BackButton />
        </div>
      </div>
      {/* What hobkin said to the last press, in one line's room so nothing under it moves. */}
      <p role="status" className="h-4 truncate text-right text-[12px] leading-4 text-muted-foreground">
        {said}
      </p>
    </header>
  )
}

function BackButton() {
  return (
    <Button variant="ghost" data-stop="" onClick={() => useView.getState().closeProof()} className="h-9 rounded-xl text-[13.5px]">
      Back
    </Button>
  )
}

function BackRow() {
  return (
    <header className="flex items-center justify-between gap-4">
      <h1 className="eyebrow">Proof run</h1>
      <BackButton />
    </header>
  )
}

function RunPanel({ run, now }: { run: ProofRun; now: number }) {
  const onCode = useCodeOpener(run)
  return <RunView run={run} now={now} zone={ZONE} onTab={null} onCode={onCode} />
}

/** Opens an action's code in the app's own viewer, from the folder an agent of the run's item worked in, when hobkin says. */
function useCodeOpener(run: ProofRun): ((where: string) => void) | null {
  const runs = useHost((state) => state.snapshot.runs)
  const folder = useMemo(() => folderOf(run, runs ?? []), [run, runs])
  if (!folder) return null
  return (where) => useViewer.getState().openFile(`${folder}/${where.replace(/:\d+$/, '')}`)
}

function folderOf(run: Pick<ProofRun, 'project' | 'item'>, runs: readonly RunSummary[]): string | null {
  if (!run.project || !run.item) return null
  const mine = runs.filter((candidate) => candidate.work?.slug === run.project && candidate.work?.item === run.item && candidate.cwd?.startsWith('/'))
  return mine.at(-1)?.cwd?.replace(/\/$/, '') ?? null
}
