import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { SCREEN_COLUMN, SCREEN_SCROLLER } from '@/app/screen-layout.ts'
import { useStill } from '@/app/still.ts'
import { useStops } from '@/app/stops.ts'
import { useView } from '@/app/view-store.ts'
import { Hob } from '@/avatar/Hob.tsx'
import type { Mood } from '@/avatar/moods.tsx'
import { Button } from '@/components/ui/button.tsx'
import { useViewer } from '@/features/viewer/store.ts'
import { useWorkView } from '@/features/work/store.ts'
import { useHost } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import type { ProofRun } from '#shared/protocol/proofs.ts'
import type { RunSummary } from '#shared/protocol/snapshot.ts'
import { useProofMemory } from './kept.ts'
import { openRunAmong } from './open-run.ts'
import { loadGraphView, ProofBody, useBoxLayout } from './ProofBody.tsx'
import { ProofKeyHints, RunFacts, showPart, useLanding, useProofKeys, useRunControl, type MoveTo } from './ProofParts.tsx'
import type { ProofLayout } from './proof-layout.ts'
import { itemTitle, placeOf, specFile } from './proof-match.ts'
import './proofs.css'
import { phaseOf, type Tone } from './run/run-view.ts'
import { siblingsOf } from './siblings.ts'
import { useProofRun, useProofRuns } from './use-proof-run.ts'

/** Side by side the page runs wider than the app's other screens, to 1,400 pixels, so the two halves have room. */
const WIDE_COLUMN = 'px-[max(0px,calc((100%_-_1400px)_/_2))]'

/**
 * A TLA+ proof run, a page of its own (050-tla-proofs), opened from a finished card, an agent's step or the YOLO page:
 * where it belongs and its item's title, how it stands, the one control that stops or runs it again, which model of
 * the change it is and what failed, and its views, side by side where the page has room and tabs where it does not
 * (`ProofBody`). Its keys are the proof's (`proof-keys.ts`). Escape and Back return to where it was opened from.
 * Without a host it shows the sample check.
 */
export function ProofScreen({ layout: given }: { /** For a still render: the layout to draw, with nothing measured. */ layout?: ProofLayout } = {}) {
  const root = useRef<HTMLDivElement | null>(null)
  const frame = useRef<HTMLDivElement | null>(null)
  useStops(root)
  const id = useView((view) => view.openProof)
  const shown = useProofRun(id)
  const layout = useBoxLayout(root, given)
  useEffect(() => {
    void loadGraphView()
  }, [])

  return (
    <div ref={root} className={SCREEN_SCROLLER}>
      <div ref={frame} tabIndex={-1} className={`${layout === 'side' ? WIDE_COLUMN : SCREEN_COLUMN} @container flex flex-col gap-5 pb-20 outline-none`}>
        {shown.run ? (
          <PageRun run={shown.run} now={shown.now} live={shown.live} complete={shown.complete} layout={layout} frame={frame} />
        ) : (
          <BackRow />
        )}
        {shown.run ? null : <p className="text-[13.5px] text-muted-foreground">{shown.problem ?? 'This proof run is not among the ones hobkin keeps.'}</p>}
        {shown.run && shown.problem ? <p className="text-[12px] text-muted-foreground">Only the latest counts show: {shown.problem}</p> : null}
        {shown.live ? null : <p className="text-[12px] text-muted-foreground">Sample data. No host is running, so nothing here reaches hobkin.</p>}
      </div>
    </div>
  )
}

/** The siblings the opener named, or the change's runs from the slice, the same array while they are the same. */
function useSiblings(id: string): string[] {
  const named = useProofMemory((memory) => memory.siblings)
  const { proofs } = useProofRuns()
  const ids = siblingsOf(id, named, proofs.runs)
  const key = ids.join('\n')
  return useMemo(() => ids, [key])
}

interface PageRunProps {
  run: ProofRun
  now: number | null
  live: boolean
  complete: boolean
  layout: ProofLayout
  frame: RefObject<HTMLDivElement | null>
}

function PageRun({ run, now, live, complete, layout, frame }: PageRunProps) {
  const siblings = useSiblings(run.id)
  const onCode = useCodeOpener(run)
  useLanding(run, complete)
  // J and K, and Run again, open the next run on the same page, among the same siblings.
  const onMove: MoveTo = (next, replaces) => openRunAmong(next, replaces ? siblings.map((sibling) => (sibling === replaces ? next : sibling)) : siblings)
  const control = useRunControl(run, live, onMove)
  useProofKeys(frame, { run, layout, siblings, panel: false, onMove, onControl: () => void control.press() })

  return (
    <>
      <Header run={run} siblings={siblings} onMove={onMove} control={control} />
      <ProofBody key={run.id} run={run} now={now} layout={layout} tabsId="proof" onPart={(part) => showPart(frame.current, run, layout, part)} onCode={onCode} />
    </>
  )
}

const MOOD: Readonly<Record<Tone, Mood>> = { live: 'working', ok: 'happy', bad: 'confused', warn: 'focused', quiet: 'idle' }
const DOT: Readonly<Record<Tone, string>> = { live: 'pf-pulse bg-sun', ok: 'bg-ok-fg', bad: 'bg-bad-fg', warn: 'bg-warn-fg', quiet: 'bg-muted-foreground' }

interface HeaderProps {
  run: ProofRun
  siblings: readonly string[]
  onMove: MoveTo
  control: ReturnType<typeof useRunControl>
}

/**
 * Where the run belongs and its title, how it stands, and Stop or Run again, then Back. Under them which model of how
 * many it is and what failed, then its keys beside what hobkin said to the last press. The buttons keep their width and
 * every row its height, so nothing under them moves.
 */
function Header({ run, siblings, onMove, control }: HeaderProps) {
  const still = useStill()
  const { work } = useWorkView()
  const agents = useHost((state) => state.snapshot.runs)
  const title = itemTitle(run, work, agents ?? []) ?? `The model in ${specFile(run.spec)}`
  const phase = phaseOf(run)

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
          <Button variant="outline" data-stop="" disabled={control.busy} focusableWhenDisabled onClick={() => void control.press()} className="h-9 w-[112px] rounded-xl text-[13.5px]">
            {control.control.label}
          </Button>
          <BackButton />
        </div>
      </div>
      <RunFacts run={run} siblings={siblings} onMove={onMove} className="mt-1 -ml-1.5" />
      <div className="flex h-5 items-center gap-4">
        <ProofKeyHints className="flex-1" />
        {/* What hobkin said to the last press, in one line's room so nothing under it moves. */}
        <p role="status" className="max-w-[50%] truncate text-right text-[12px] leading-4 text-muted-foreground">
          {control.said}
        </p>
      </div>
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

/** Opens an action's code in the app's own viewer, from the folder an agent of the run's item worked in, when hobkin says. */
function useCodeOpener(run: ProofRun | null): ((where: string) => void) | null {
  const agents = useHost((state) => state.snapshot.runs)
  const folder = run ? folderOf(run, agents ?? []) : null
  if (!folder) return null
  return (where) => {
    const path = where.replace(/:\d+$/, '')
    useViewer.getState().openFile(`${folder}/${path}`)
  }
}

/** The folder an agent worked on the run's item in, as a full path. Null for a run of no item, or when no agent says. */
function folderOf(run: Pick<ProofRun, 'project' | 'item'>, agents: readonly RunSummary[]): string | null {
  if (!run.project || !run.item) return null
  const agent = agents.findLast(({ work, cwd }) => work?.slug === run.project && work?.item === run.item && cwd?.startsWith('/'))
  return agent?.cwd?.replace(/\/$/, '') ?? null
}
