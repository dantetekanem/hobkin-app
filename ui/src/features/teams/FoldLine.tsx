import { ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { holdStill, useStill } from '@/app/still.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
// The line's glow is the tasks line's own (`aa-glow`).
import '@/features/agent-activity/agent-activity.css'
import { useDrop, type DropName } from '@/features/agent-activity/drop.ts'
import { glowIn, liveIf } from '@/features/agent-activity/glow.ts'
import { useRoom } from '@/features/agent-activity/TaskList.tsx'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'

/** How many faces the line stacks. */
const FACES = 3

/** The list a fold line opens: its heading, how many stand in each state, and its rows (each an `li`). */
export interface FoldList {
  title: string
  counts: string
  /** What the rows are, for a screen reader. */
  label: string
  /** Drawn only while the list is open. */
  rows: ReactNode
  /** The key that opens it from anywhere on the page, shown in its heading, such as "⌃⌥W". */
  keys?: string
}

interface FoldLineProps {
  /** Which list it opens, one of those that share the place under the header (drop.ts). */
  drop: Exclude<DropName, 'tasks'>
  /** Every one's face, the first drawn first; the line stacks the first few. */
  faces: readonly { key: string; face: ReactNode }[]
  /** How many, such as "2 agents". */
  count: string
  /** Every one and how it stands, for a screen reader. */
  summary: string
  /** One of them is working: the border breathes (glow.ts). */
  live: boolean
  hue: number
  list: FoldList
  /** Drawn beside the line, such as a sheet a row opens. */
  children?: ReactNode
  className?: string
}

/**
 * An agent's subagents folded into one line, as the tasks line beside it reads: their faces and how many, such as
 * "2 agents". It is as wide as its words, up to 22rem, and its border breathes while one of them is working. A press or
 * Enter opens every one under it, and the same again closes it; Escape inside closes it too. It shares its place under
 * the header with the other lists, so opening one closes the others.
 *
 * Mount it in a positioned row: the open list hangs from that row, under the line.
 */
export function FoldLine({ drop, faces, count, summary, live, hue, list, children, className }: FoldLineProps) {
  const still = useStill()
  const open = useDrop((state) => state.open === drop)
  const bar = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  const toggle = () => {
    // The keyboard inside the list as it closes goes back to the line.
    const keyboardInList = document.getElementById(panelId)?.contains(document.activeElement)
    if (open && keyboardInList) bar.current?.focus({ preventScroll: true })
    useDrop.getState().setOpen(drop, !open)
  }

  return (
    <div
      className={cn('flex min-w-0 max-w-[22rem] items-center', className)}
      onKeyDown={(event) => {
        if (!open || event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        toggle()
      }}
    >
      <motion.button
        ref={bar}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`${summary}. ${open ? 'Hide' : 'Show'} every one.`}
        onClick={toggle}
        {...liveIf(live)}
        style={glowIn(hue)}
        // Its own transform at rest, for a press to spring back to. With none, Motion takes scale(0) as the rest and
        // the line vanishes once it is clicked.
        initial={false}
        animate={{ transform: 'scale(1)' }}
        whileTap={holdStill({ transform: 'scale(0.97)', transition: { duration: 0.14 } }, still)}
        className="aa-glow flex h-7 min-w-0 items-center gap-2 rounded-full bg-surface-2 pr-1.5 pl-2 text-[12px] outline-none transition-colors duration-[160ms] ease-[ease] hover:bg-secondary focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]"
      >
        <span className="flex shrink-0 items-center" aria-hidden="true">
          {faces.slice(0, FACES).map(({ key, face }, index) => (
            <span key={key} className={cn(index > 0 && '-ml-1')}>
              {face}
            </span>
          ))}
        </span>
        <span className="shrink-0 text-muted-foreground tabular-nums">{count}</span>
        <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)]', open && 'rotate-180')} aria-hidden="true" />
      </motion.button>
      <AnimatePresence>{open ? <FoldPanel key="panel" id={panelId} list={list} still={still} /> : null}</AnimatePresence>
      {children}
    </div>
  )
}

/**
 * Every one under the line, as the tasks list hangs under its own. It opens under the line's left end, at most 28rem
 * wide, moved left only as far as the row needs to hold it whole.
 */
function FoldPanel({ id, list, still }: { id: string; list: FoldList; still: boolean }) {
  const outer = useRef<HTMLDivElement>(null)
  const room = useRoom(outer)
  const lineLeft = useLineLeft(outer)
  return (
    // Spans the row the line sits in, so the list stands under it within the row.
    <div
      ref={outer}
      className="pointer-events-none absolute inset-x-0 top-full z-20 mt-2 flex"
      style={{ paddingLeft: `max(0px, min(${lineLeft}px, 100% - 28rem))` }}
    >
      <motion.div
        id={id}
        role="region"
        aria-label={list.title}
        // The key that opens it can hand it the keyboard, so Tab walks its controls.
        tabIndex={-1}
        style={{ maxHeight: room }}
        initial={holdStill({ opacity: 0, transform: 'translateY(-6px) scale(0.96)' }, still)}
        animate={holdStill({ opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.sheet, opacity: tween.enter } }, still)}
        exit={holdStill({ opacity: 0, transform: 'translateY(-4px) scale(0.96)', transition: tween.exit }, still)}
        className="pointer-events-auto flex w-full max-w-[28rem] origin-top-left flex-col overflow-hidden rounded-[18px] border border-border bg-popover text-popover-foreground shadow-panel outline-none"
      >
        <div className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-1.5">
          <span className="text-[13px] font-medium">{list.title}</span>
          <span className="min-w-0 truncate text-[12px] text-muted-foreground tabular-nums">{list.counts}</span>
          {list.keys ? <Kbd className="ml-auto">{list.keys}</Kbd> : null}
        </div>
        <ul aria-label={list.label} className="scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
          {list.rows}
        </ul>
      </motion.div>
    </div>
  )
}

/** Where the line that holds the list starts in its row, read as the list opens. */
function useLineLeft(list: RefObject<HTMLElement | null>): number {
  const [left, setLeft] = useState(0)
  useLayoutEffect(() => {
    const line = list.current?.parentElement
    if (line) setLeft(line.offsetLeft)
  }, [list])
  return left
}

/** What a subagent runs on, under its name in an open list: its tier, model and thinking level, or nothing when none is known. */
export function RunsOnLine({ words }: { words: readonly string[] }) {
  if (words.length === 0) return null
  return <span className="min-w-0 truncate text-[11.5px] text-muted-foreground">{words.join(' · ')}</span>
}
