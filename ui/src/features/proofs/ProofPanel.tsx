import { Maximize2, X } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { cn } from '@/lib/utils.ts'
import type { ProofRun } from '#shared/protocol/proofs.ts'
import { loadGraphView, ProofBody, useBoxLayout } from './ProofBody.tsx'
import { ProofKeyHints, RunFacts, showPart, useCodeOpener, useLanding, useProofKeys, useRunControl, type MoveTo } from './ProofParts.tsx'
import type { ProofLayout } from './proof-layout.ts'
import { specFile } from './proof-match.ts'
import './proofs.css'
import { phaseOf, type Tone } from './run/run-view.ts'
import { useShownRun } from './shown-run.ts'
import { siblingsOf } from './siblings.ts'
import { useProofRun, useProofRuns } from './use-proof-run.ts'

export interface ProofPanelProps {
  /** The run to show, by id. A new id from the page that holds the panel shows that run. */
  run: string
  /**
   * The other model checks and proofs of the same change, the run among them, in the order the page shows them. J and K
   * move through them. Left out, or without the run, the panel finds the change's runs in the proofs slice.
   */
  siblings?: readonly string[]
  /** Closed, the panel mounts nothing. */
  open?: boolean
  /** The panel's close button, Escape and T. */
  onClose: () => void
  /** The panel's expand button and Shift+T: open the full page at `id`, the run the panel shows now. */
  onExpand: (id: string) => void
  /** Opens an action's code, `path:line` in the project. Left out, the app's viewer opens it where hobkin says the item's folder is; null opens nothing. */
  onCode?: ((where: string) => void) | null
  /** Hears each run the panel shows: the first, each one J, K or Run again moves to, and a new `run`. */
  onShow?: (id: string) => void
  /** For a still render: the layout to draw, with nothing measured. */
  layout?: ProofLayout
}

/**
 * A proof run in a box another page holds (053-work-control-room, "Proofs"), such as beside the review of its change: a
 * heading with the model, how it stands, which of the change's models it is, Stop or Run again, and its expand and close
 * buttons, over the same views as the full page. Narrower than 1,100 pixels they are tabs, wider the check and the proof
 * show side by side. Its keys are the proof's, and Escape and T close it; a key it uses goes no further, so the page
 * under it does not see it. The state graph's code loads as it opens. Closed, it mounts nothing.
 */
export function ProofPanel({ open = true, ...props }: ProofPanelProps) {
  return open ? <OpenPanel {...props} /> : null
}

function OpenPanel({ run: asked, siblings: given = [], onClose, onExpand, onCode, onShow, layout: still }: Omit<ProofPanelProps, 'open'>) {
  const box = useRef<HTMLElement | null>(null)
  // J and K move the panel along its siblings; a new run from the page that holds it starts there again.
  const [id, moveTo] = useShownRun(asked, onShow)
  // Run again starts a run of its own, which takes the old one's place among the siblings.
  const [renamed, setRenamed] = useState<Readonly<Record<string, string>>>({})
  const { run, live, now, complete, problem } = useProofRun(id)
  const { proofs } = useProofRuns()
  const siblings = siblingsOf(id, given.map((sibling) => renamed[sibling] ?? sibling), proofs.runs)
  const layout = useBoxLayout(box, still)
  useEffect(() => {
    void loadGraphView()
  }, [])

  const onMove: MoveTo = (next, replaces) => {
    if (replaces) setRenamed((before) => ({ ...before, [replaces]: next }))
    moveTo(next)
  }

  return (
    <section
      ref={box}
      data-proof-panel=""
      tabIndex={-1}
      aria-label="Proof run"
      className="@container scroll-quiet flex h-full min-w-0 flex-col gap-4 overflow-y-auto bg-background px-5 pt-4 pb-10 outline-none"
    >
      {run ? (
        <PanelRun run={run} now={now} live={live} complete={complete} layout={layout} box={box} siblings={siblings} onMove={onMove} onClose={onClose} onExpand={onExpand} onCode={onCode} />
      ) : (
        <div className="flex items-start justify-between gap-3">
          <p className="pt-1.5 text-[13px] text-muted-foreground">{problem ?? 'This proof run is not among the ones hobkin keeps.'}</p>
          <CloseButton onClose={onClose} />
        </div>
      )}
      {run && problem ? <p className="text-[12px] text-muted-foreground">Only the latest counts show: {problem}</p> : null}
      {live ? null : <p className="text-[12px] text-muted-foreground">Sample data. No host is running, so nothing here reaches hobkin.</p>}
    </section>
  )
}

interface PanelRunProps extends Pick<ProofPanelProps, 'onClose' | 'onExpand' | 'onCode'> {
  run: ProofRun
  now: number | null
  live: boolean
  complete: boolean
  layout: ProofLayout
  box: RefObject<HTMLElement | null>
  siblings: readonly string[]
  onMove: MoveTo
}

function PanelRun({ run, now, live, complete, layout, box, siblings, onMove, onClose, onExpand, onCode }: PanelRunProps) {
  const opener = useCodeOpener(run)
  const control = useRunControl(run, live, onMove)
  useLanding(run, complete)
  useProofKeys(box, { run, layout, siblings, panel: true, onMove, onControl: () => void control.press(), onClose, onExpand })

  return (
    <>
      <PanelHeading run={run} siblings={siblings} onMove={onMove} control={control} onClose={onClose} onExpand={onExpand} />
      <ProofBody key={run.id} run={run} now={now} layout={layout} tabsId="proof-panel" panel onPart={(part, landing) => showPart(box.current, run, layout, part, { landing })} onCode={onCode === undefined ? opener : onCode} />
    </>
  )
}

const DOT: Readonly<Record<Tone, string>> = { live: 'pf-pulse bg-sun', ok: 'bg-ok-fg', bad: 'bg-bad-fg', warn: 'bg-warn-fg', quiet: 'bg-muted-foreground' }

interface PanelHeadingProps extends Pick<ProofPanelProps, 'onClose' | 'onExpand'> {
  run: ProofRun
  siblings: readonly string[]
  onMove: MoveTo
  control: ReturnType<typeof useRunControl>
}

/**
 * The model and how it stands, with expand and close at the end; which of the change's models it is and what failed,
 * with Stop or Run again; then its keys beside what hobkin said to the last press. Every row keeps its height.
 */
function PanelHeading({ run, siblings, onMove, control, onClose, onExpand }: PanelHeadingProps) {
  const phase = phaseOf(run)
  const model = specFile(run.spec).replace(/\.tla$/, '')
  return (
    <header className="flex flex-col gap-1">
      <div className="flex h-9 min-w-0 items-center gap-3">
        <span className="eyebrow shrink-0">Proof</span>
        <h2 title={run.spec} className="min-w-0 shrink truncate font-mono text-[15px] font-semibold">
          {model}
        </h2>
        <span className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
          <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', DOT[phase.tone])} />
          <span className="truncate">{phase.label}</span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" data-stop="" aria-label="Open the full page" title="Open the full page (Shift+T)" onClick={() => onExpand(run.id)}>
            <Maximize2 aria-hidden />
          </Button>
          <CloseButton onClose={onClose} />
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <RunFacts run={run} siblings={siblings} onMove={onMove} className="min-w-0 flex-1 -ml-1.5" />
        <Button variant="outline" data-stop="" disabled={control.busy} focusableWhenDisabled onClick={() => void control.press()} className="h-8 w-[104px] shrink-0 rounded-xl text-[13px]">
          {control.control.label}
        </Button>
      </div>
      <div className="flex h-5 items-center gap-4">
        <ProofKeyHints panel className="flex-1" />
        {/* What hobkin said to the last press, in one line's room so nothing under it moves. */}
        <p role="status" className="max-w-[50%] truncate text-right text-[12px] leading-4 text-muted-foreground">
          {control.said}
        </p>
      </div>
    </header>
  )
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <Button variant="ghost" size="icon" data-stop="" aria-label="Close the proof" title="Close (Escape or T)" onClick={onClose}>
      <X aria-hidden />
    </Button>
  )
}
