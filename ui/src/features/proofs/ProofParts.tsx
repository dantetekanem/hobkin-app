import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { runCommand } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import type { ProofRun } from '#shared/protocol/proofs.ts'
import { failureAt, failureLine, failuresOf, stepFailure } from './failures.ts'
import { keep, keptOf, type ProofTab } from './kept.ts'
import { focusPart } from './ProofBody.tsx'
import { proofKey, PROOF_KEY_HINTS } from './proof-keys.ts'
import type { ProofLayout } from './proof-layout.ts'
import { controlOf } from './run/run-view.ts'
import { positionWords, siblingAt } from './siblings.ts'

/**
 * The parts a proof run's page and its panel beside another page share (053-work-control-room, "Proofs"): the one
 * control that stops it or runs it again, the row that says which model of how many it is and what failed, the quiet
 * row of its keys, and the keys themselves.
 */

/** Goes to another run: a sibling, or the run Run again started, which takes the place of `replaces` among them. */
export type MoveTo = (id: string, replaces?: string) => void

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

/** Which model of how many this is, with K and J as buttons, and what failed in it. One line whatever it says. */
export function RunFacts({ run, siblings, onMove, className }: { run: ProofRun; siblings: readonly string[]; onMove: MoveTo; className?: string }) {
  const previous = siblingAt(siblings, run.id, -1)
  const next = siblingAt(siblings, run.id, 1)
  const failed = failuresOf(run).length > 0
  return (
    <div className={cn('flex h-7 min-w-0 items-center gap-3 text-[12.5px] text-muted-foreground', className)}>
      <span className="flex shrink-0 items-center gap-0.5">
        <Button variant="ghost" size="icon-sm" data-stop="" disabled={!previous} aria-label="Previous model" title="Previous model (K)" onClick={() => previous && onMove(previous)}>
          <ChevronLeft aria-hidden />
        </Button>
        <span className="w-[92px] text-center text-foreground tabular-nums">{positionWords(siblings, run.id)}</span>
        <Button variant="ghost" size="icon-sm" data-stop="" disabled={!next} aria-label="Next model" title="Next model (J)" onClick={() => next && onMove(next)}>
          <ChevronRight aria-hidden />
        </Button>
      </span>
      <span title={failureLine(run)} className={cn('min-w-0 truncate tabular-nums', failed && 'text-bad-fg')}>
        {failureLine(run)}
      </span>
    </div>
  )
}

/** The proof's keys, in a quiet row of one line's room, as the app's hints under the chat are. */
export function ProofKeyHints({ panel = false, className }: { panel?: boolean; className?: string }) {
  return (
    <div className={cn('select-none-chrome flex h-5 min-w-0 flex-wrap items-center gap-x-3 overflow-hidden text-[11px] text-muted-foreground', className)}>
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

/** Shows a part: its tab in tabs, and side by side the keyboard goes to it. `target` picks one element of it. */
export function showPart(root: HTMLElement | null, run: ProofRun, layout: ProofLayout, part: ProofTab, target?: string) {
  if (layout === 'tabs') keep(run.id, { tab: part })
  focusPart(root, part, target)
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
          return showPart(element, run, layout, 'graph', '[data-proof-search]')
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
