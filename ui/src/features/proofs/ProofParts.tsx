import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { useViewer } from '@/features/viewer/store.ts'
import { runCommand, useHost } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import type { ProofRun } from '#shared/protocol/proofs.ts'
import type { RunSummary } from '#shared/protocol/snapshot.ts'
import { failureAt, failureLine, failuresOf, land, stepFailure } from './failures.ts'
import { keep, keptOf, useKept, type Landing, type ProofTab } from './kept.ts'
import { choosePart } from './open-run.ts'
import { focusPart } from './ProofBody.tsx'
import { proofKey, PROOF_KEY_HINTS } from './proof-keys.ts'
import type { ProofLayout } from './proof-layout.ts'
import { controlOf, evidenceLine } from './run/run-view.ts'
import { positionWords, siblingAt } from './siblings.ts'

/**
 * The parts a proof run's page and its panel beside another page share (053-work-control-room, "Proofs"): the one
 * control that stops it or runs it again, the row that says which model of how many it is and what failed, the quiet
 * row of its keys, and the keys themselves.
 */

/** Goes to another run: a sibling, or the run Run again started, which takes the place of `replaces` among them. */
export type MoveTo = (id: string, replaces?: string) => void

/** Opens an action's code in the app's own viewer, from the folder an agent of the run's item worked in, when hobkin says. */
export function useCodeOpener(run: ProofRun | null): ((where: string) => void) | null {
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

/** Stop while it checks, Run again once it ended, and what hobkin said to the last press. */
export function useRunControl(run: ProofRun, live: boolean, onMove: MoveTo) {
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
      // Run again starts a new run: the page follows it when hobkin names it.
      const started = 'id' in answer ? answer.id : undefined
      if (started) onMove(started, run.id)
      else setSaid(answer.message)
    } catch (error) {
      setSaid(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return { control, said, busy, press }
}

/**
 * Which model of how many this is, with K and J as buttons, what failed in it, and, when hobkin does not count it as
 * evidence for its change, why. One line whatever it says.
 */
export function RunFacts({ run, siblings, onMove, className }: { run: ProofRun; siblings: readonly string[]; onMove: MoveTo; className?: string }) {
  return (
    <div className={cn('flex h-7 min-w-0 items-center gap-3 text-[12.5px] text-muted-foreground', className)}>
      <ModelPosition run={run} siblings={siblings} onMove={onMove} />
      <RunNotes run={run} />
    </div>
  )
}

/** "Model 2 of 5" between K and J as buttons, in a room of one width. */
export function ModelPosition({ run, siblings, onMove, className }: { run: ProofRun; siblings: readonly string[]; onMove: MoveTo; className?: string }) {
  const previous = siblingAt(siblings, run.id, -1)
  const next = siblingAt(siblings, run.id, 1)
  return (
    <span className={cn('flex shrink-0 items-center gap-0.5 text-[12.5px]', className)}>
      <Button variant="ghost" size="icon-sm" data-stop="" disabled={!previous} aria-label="Previous model" title="Previous model (K)" onClick={() => previous && onMove(previous)}>
        <ChevronLeft aria-hidden />
      </Button>
      <span className="w-[92px] text-center text-foreground tabular-nums">{positionWords(siblings, run.id)}</span>
      <Button variant="ghost" size="icon-sm" data-stop="" disabled={!next} aria-label="Next model" title="Next model (J)" onClick={() => next && onMove(next)}>
        <ChevronRight aria-hidden />
      </Button>
    </span>
  )
}

/**
 * What failed, and why the run is not evidence when it is not. Inline they share one line; `stacked`, each has a line of
 * its own, two lines' room whatever they say, which a panel uses below 700 pixels so both read whole.
 */
export function RunNotes({ run, stacked = false }: { run: ProofRun; stacked?: boolean }) {
  const failed = failuresOf(run).length > 0
  const evidence = evidenceLine(run)
  const line = failureLine(run)
  return (
    <span className={cn('flex min-w-0 text-[12.5px] text-muted-foreground', stacked ? 'h-10 flex-col justify-center leading-5 @min-[700px]:h-5 @min-[700px]:flex-row @min-[700px]:justify-start @min-[700px]:gap-3' : 'flex-1 items-center gap-3')}>
      <span title={line} className={cn('min-w-0 shrink-0 truncate tabular-nums', !stacked && 'shrink', failed && 'text-bad-fg')}>
        {line}
      </span>
      <span title={evidence ?? undefined} className="min-w-0 truncate text-warn-fg">
        {evidence}
      </span>
    </span>
  )
}

/**
 * Lands a run where its opener asked once the run is whole: "Proof fails" picks the proof tree's first failed step, a
 * broken model the trace's break. Its part shows; the keyboard stays where the page put it.
 */
export function useLanding(run: ProofRun, complete: boolean): void {
  const landing = useKept(run.id, 'landing')
  useEffect(() => {
    if (!landing || !complete) return
    keep(run.id, (kept) => land(run, kept))
  }, [landing, complete, run])
}

/**
 * The proof's keys, in a quiet row, as the app's hints under the chat are: one line's room on the page. In a panel,
 * two lines' room below 640 pixels and one above, so every hint shows whole. A hint that does not fit goes whole to
 * the next line, never cut.
 */
export function ProofKeyHints({ panel = false, className }: { panel?: boolean; className?: string }) {
  return (
    <div
      className={cn(
        'select-none-chrome flex min-w-0 flex-wrap content-start items-center gap-x-3 gap-y-1 overflow-hidden text-[11px] text-muted-foreground',
        panel ? 'h-11 @min-[640px]:h-5' : 'h-5',
        className,
      )}
    >
      {PROOF_KEY_HINTS.filter((hint) => panel || !hint.panel).map(({ keys, does }) => (
        <span key={keys} className="flex items-center gap-1 whitespace-nowrap">
          {keys.split(' ').map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
          {does}
        </span>
      ))}
    </div>
  )
}

const typingIn = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'))

/** Walks the box's controls with Up and Down, as a screen's walk does (`app/stops.ts`), for a panel inside another page. */
function walk(root: HTMLElement, delta: 1 | -1) {
  const stops = [...root.querySelectorAll<HTMLElement>('[data-stop]')].filter((stop) => !stop.hasAttribute('disabled'))
  const at = stops.indexOf(document.activeElement as HTMLElement)
  const next = stops[delta > 0 ? Math.min(stops.length - 1, at + 1) : Math.max(0, at - 1)]
  next?.focus()
  next?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

export interface ProofKeyHandlers {
  run: ProofRun
  layout: ProofLayout
  siblings: readonly string[]
  /** A panel beside another page, whose Escape, T and Up and Down are its own. */
  panel: boolean
  onMove: MoveTo
  /** Presses Stop or Run again. */
  onControl: () => void
  onClose?: () => void
  onExpand?: (id: string) => void
}

/**
 * Shows a part and gives it the keyboard: its tab in tabs, as every part shows side by side. `landing` picks the break
 * or the first failed step in it, and `target` one element of it, such as the search.
 */
export function showPart(root: HTMLElement | null, run: ProofRun, layout: ProofLayout, part: ProofTab, { target, landing }: { target?: string; landing?: Landing } = {}) {
  focusPart(root, part, choosePart(run, layout, part, landing) ?? target)
}

/**
 * The proof's keys (`proof-keys.ts`), while the keyboard is anywhere in `root`. The listener sits on the box itself, so
 * it hears a key before a page the box sits in does, and a key it used goes no further.
 */
export function useProofKeys(root: RefObject<HTMLElement | null>, handlers: ProofKeyHandlers): void {
  const latest = useRef(handlers)
  latest.current = handlers

  useEffect(() => {
    const element = root.current
    if (!element) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const { run, layout, siblings, panel, onMove, onControl, onClose, onExpand } = latest.current
      const action = proofKey({ key: event.key, shift: event.shiftKey, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, typing: typingIn(event.target), composing: event.isComposing }, { panel })
      if (!action) return
      event.preventDefault()
      event.stopPropagation()
      switch (action.do) {
        case 'sibling': {
          const next = siblingAt(siblings, run.id, action.delta)
          if (!next) return
          // What has the keyboard goes with the run it shows, so the box keeps the keyboard.
          element.focus({ preventScroll: true })
          onMove(next)
          return
        }
        case 'failure': {
          const failures = failuresOf(run)
          const at = stepFailure(failures.length, keptOf(run.id).failure, action.delta)
          if (at === null) return
          const failure = failures[at]!
          keep(run.id, (kept) => failureAt(kept, failure, at))
          if (failure.part === 'graph') focusPart(element, 'graph')
          else focusPart(element, 'math', `[data-proof-step="${failure.index}"]`)
          return
        }
        case 'part':
          return showPart(element, run, layout, action.part)
        case 'search':
          return showPart(element, run, layout, 'graph', { target: '[data-proof-search]' })
        case 'again':
          // R runs it again. While it checks, Stop stays a press of its button.
          if (run.outcome !== 'checking') onControl()
          return
        case 'close':
          return onClose?.()
        case 'expand':
          return onExpand?.(run.id)
        case 'walk':
          return walk(element, action.delta)
      }
    }
    element.addEventListener('keydown', onKeyDown)
    return () => element.removeEventListener('keydown', onKeyDown)
  }, [root])
}
