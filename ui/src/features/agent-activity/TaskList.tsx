import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown } from 'lucide-react'
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type RefObject } from 'react'
import { inOverlay } from '@/app/key-page.ts'
import { holdStill, useStill } from '@/app/still.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import './agent-activity.css'
import { useDrop } from './drop.ts'
import { glowIn, liveIf, tasksGlow } from './glow.ts'
import { taskListKey, type TaskKeyPress } from './task-keys.ts'
import { progressOf, taskCount, titleOf, type AgentTask, type TaskProgress, type TaskState } from './tasks.ts'

/** The list never reaches the bottom of the transcript: the newest step and the way back to it stay in view. */
const LEAVE = 56
const LEAST_ROOM = 96
/**
 * The room the row of positions takes in the bar, the same however many tasks there are, so the line keeps its width
 * as tasks arrive and nothing beside it moves. How many fit it before they pack closer.
 */
const TRACK_ROOM = 84
const LONG_TRACK = 16
/** The widest the count gets up to 99 tasks, kept with tabular numbers, so the line keeps its width as tasks finish. */
const COUNT_ROOM = '00 of 00 tasks'

const pressOf = (event: { key: string; code: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean }): TaskKeyPress => ({
  key: event.key,
  code: event.code,
  ctrl: event.ctrlKey,
  alt: event.altKey,
  meta: event.metaKey,
  shift: event.shiftKey,
})

/** This agent's screen is the one shown, and these are not the pieces of an agent on its way out. */
function shownNow(element: Element): boolean {
  if (element.closest('[inert]')) return false
  const section = element.closest<HTMLElement>('[data-canvas-screen]')
  return section?.dataset.canvasScreen === document.querySelector<HTMLElement>('[data-active-canvas-screen]')?.dataset.activeCanvasScreen
}

/** Opens the list, or closes it. The keyboard inside the list as it closes goes back to its bar. */
function toggleList(root: HTMLElement | null, bar: HTMLButtonElement | null): void {
  const open = useDrop.getState().open === 'tasks'
  if (open && root?.querySelector('[data-task-panel]')?.contains(document.activeElement)) bar?.focus({ preventScroll: true })
  useDrop.getState().setOpen('tasks', !open)
}

/**
 * The agent's tasks (tasks.ts) in one short line, held in place while its steps scroll by: a position for every task
 * and how many are done of how many, "2 of 5 tasks". Its task tool calls are not drawn as steps (steps.ts,
 * `tasksOnLine`): this is where they show. A click on the line or Enter on it opens every task under it, in the order
 * they run, with its state and its description, and the same again closes it. Control+Option+T does the same from anywhere on the screen
 * (task-keys.ts), and Escape inside closes it. It opens over the transcript and leaves its bottom in view, so it takes
 * no room from it. Nothing shows for an agent that keeps no tasks.
 *
 * Mount it outside the steps' scroller, first in a positioned row (`AgentLines.tsx`): the open list hangs from that
 * row's left end, under the line, at a width its words read well at. Given tasks kept as they are until a task changes,
 * it draws again only for new tasks.
 */
export const Tasks = memo(TaskBar)

function TaskBar({ tasks, hue }: { tasks: readonly AgentTask[]; hue: number }) {
  const still = useStill()
  const progress = useMemo(() => progressOf(tasks), [tasks])
  const count = taskCount(progress)
  // Its border breathes while a task is in progress (glow.ts), as the position of that task does.
  const live = tasksGlow(tasks)
  const any = tasks.length > 0
  const open = useDrop((state) => state.open === 'tasks') && any
  const root = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  // Tasks there when the screen opens are simply there. Ones that come later rise in.
  const arrivedLater = useRef(!any)

  const toggle = () => toggleList(root.current, bar.current)

  // Control+Option+T reaches the list from anywhere on the screen, so it is heard on the window.
  useEffect(() => {
    if (!any) return
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      if (taskListKey(pressOf(event), { open: false, inList: false }) !== 'toggle') return
      const element = root.current
      if (!element || !shownNow(element) || inOverlay(event.target, document)) return
      event.preventDefault()
      toggleList(element, bar.current)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [any])

  if (!any) return null

  return (
    <div
      ref={root}
      className="flex min-w-0 items-center not-first:ml-3"
      style={{ '--tasks-tint': `oklch(0.62 0.11 ${hue})` } as CSSProperties}
      onKeyDown={(event) => {
        if (taskListKey(pressOf(event), { open, inList: true }) !== 'close') return
        event.preventDefault()
        toggle()
      }}
    >
      <motion.button
        ref={bar}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`${count}. ${open ? 'Hide' : 'Show'} every task.`}
        onClick={toggle}
        {...liveIf(live)}
        style={glowIn(hue)}
        initial={arrivedLater.current ? holdStill({ opacity: 0, transform: 'translateY(8px) scale(0.96)' }, still) : false}
        animate={holdStill({ opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.rise, opacity: tween.enter } }, still)}
        whileTap={holdStill({ transform: 'translateY(0px) scale(0.97)', transition: { duration: 0.14 } }, still)}
        className="aa-glow flex h-7 min-w-0 items-center gap-2 rounded-full bg-surface-2 pr-1.5 pl-2.5 text-[12px] outline-none transition-colors duration-[160ms] ease-[ease] hover:bg-secondary focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]"
      >
        <Track tasks={tasks} still={still} />
        <span className="shrink-0 text-muted-foreground tabular-nums">
          <Count value={count} room={COUNT_ROOM} still={still} />
        </span>
        <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)]', open && 'rotate-180')} aria-hidden="true" />
      </motion.button>
      <AnimatePresence>{open ? <Panel key="panel" id={panelId} tasks={tasks} progress={progress} still={still} /> : null}</AnimatePresence>
    </div>
  )
}

/**
 * A position for every task, as the review's step pager has for its steps: the finished ones filled in the agent's
 * color, the one worked on now twice as wide and breathing, the rest faint. They share one room of a fixed width. The wide one moves along by layout animation,
 * which Motion plays as a transform. Drawn again only when a task changes.
 */
const Track = memo(function Track({ tasks, still }: { tasks: readonly AgentTask[]; still: boolean }) {
  // A long list packs its positions closer, in one row, as the pager does.
  const long = tasks.length > LONG_TRACK
  return (
    <span className="flex shrink-0 items-center overflow-hidden" style={{ width: TRACK_ROOM, gap: long ? 1 : 2 }} aria-hidden="true">
      {tasks.map((task) => (
        <motion.span
          key={task.id}
          layout={!still}
          transition={spring.pill}
          style={{ borderRadius: 999 }}
          className={cn('relative h-1 min-w-px overflow-hidden', task.state === 'now' ? 'flex-[2_1_0%]' : 'flex-1')}
        >
          <span className="absolute inset-0 bg-border-strong/40" />
          <motion.span className="absolute inset-0" initial={false} animate={{ opacity: task.state === 'queued' ? 0 : 1 }} transition={tween.enter}>
            <span className={cn('absolute inset-0 bg-[var(--tasks-tint)]', task.state === 'now' && 'aa-running')} />
          </motion.span>
        </motion.span>
      ))}
    </span>
  )
})

/** Words that change by sliding: the old ones leave upward as the new ones rise in. They keep the width of `room`. */
function Count({ value, room, still }: { value: string; room: string; still: boolean }) {
  return (
    <span className="relative inline-grid overflow-hidden text-left tabular-nums">
      <span className="invisible col-start-1 row-start-1" aria-hidden="true">
        {room}
      </span>
      <AnimatePresence initial={false}>
        <motion.span
          key={value}
          initial={holdStill({ opacity: 0, transform: 'translateY(70%)' }, still)}
          animate={holdStill({ opacity: 1, transform: 'translateY(0%)', transition: { transform: spring.rise, opacity: tween.enter } }, still)}
          exit={holdStill({ opacity: 0, transform: 'translateY(-70%)', transition: tween.exit }, still)}
          className="col-start-1 row-start-1"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

/** How tall the open list may be: from where it opens down to a little above the transcript's bottom. */
export function useRoom(outer: RefObject<HTMLElement | null>): number | undefined {
  const [room, setRoom] = useState<number>()
  useLayoutEffect(() => {
    const element = outer.current
    if (!element) return
    const transcript = element.closest('[data-canvas-screen]')?.querySelector('[data-agent-exchange]')?.parentElement ?? null
    const measure = () => {
      const bottom = transcript?.getBoundingClientRect().bottom ?? innerHeight
      setRoom(Math.max(LEAST_ROOM, Math.round(bottom - LEAVE - element.getBoundingClientRect().top)))
    }
    measure()
    const sizes = new ResizeObserver(measure)
    if (transcript) sizes.observe(transcript)
    addEventListener('resize', measure)
    return () => {
      sizes.disconnect()
      removeEventListener('resize', measure)
    }
  }, [outer])
  return room
}

const STATE_WORDS: Record<TaskState, string> = { done: 'done', now: 'in progress', queued: 'waiting' }

/**
 * Every task in the order they run, under a line that counts them, each with its state and its description. The tint
 * behind the one worked on now glides to the next. Drawn again only when a task changes.
 */
const Panel = memo(function Panel({ id, tasks, progress, still }: { id: string; tasks: readonly AgentTask[]; progress: TaskProgress; still: boolean }) {
  const outer = useRef<HTMLDivElement>(null)
  const room = useRoom(outer)
  const tint = useId()
  const rows: ReactElement[] = []
  let working = 0
  tasks.forEach((task, index) => {
    if (task.group && task.group !== tasks[index - 1]?.group) {
      rows.push(
        <motion.li key={`group:${task.id}`} layout={still ? false : 'position'} transition={{ layout: spring.sheet }} exit={{ opacity: 0, transition: tween.exit }} className="truncate px-2 pt-2 pb-0.5 text-[11px] font-medium text-muted-foreground">
          {task.group}
        </motion.li>,
      )
    }
    rows.push(rowOf(task, index, task.state === 'now' ? `${tint}:now:${working++}` : undefined, still))
  })
  return (
    // Spans the row the line sits in, 80% of the agent's screen, and stands under the line at its left end. The user,
    // 2026-11-27: "width should cover 80% of the agent screen, now is less than half".
    <div ref={outer} className="pointer-events-none absolute inset-x-0 top-full z-20 mt-2 flex">
      <motion.div
        id={id}
        data-task-panel
        role="region"
        aria-label="Every task"
        style={{ maxHeight: room }}
        initial={holdStill({ opacity: 0, transform: 'translateY(-6px) scale(0.96)' }, still)}
        animate={holdStill({ opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.sheet, opacity: tween.enter } }, still)}
        exit={holdStill({ opacity: 0, transform: 'translateY(-4px) scale(0.96)', transition: tween.exit }, still)}
        className="pointer-events-auto flex w-full origin-top-left flex-col overflow-hidden rounded-[18px] border border-border bg-popover text-popover-foreground shadow-panel"
      >
        <div className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-1.5">
          <span className="text-[13px] font-medium">Tasks</span>
          <span className="text-[12px] text-muted-foreground tabular-nums">
            {progress.done} of {progress.total} done
          </span>
          <Kbd className="ml-auto">⌃⌥T</Kbd>
        </div>
        <motion.ol
          layoutScroll
          tabIndex={0}
          aria-label="The agent's tasks, in the order they run"
          className="scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2 outline-none focus-visible:[box-shadow:inset_0_0_0_2px_var(--hb-focus)]"
        >
          <AnimatePresence initial={false} mode="popLayout">
            {rows}
          </AnimatePresence>
        </motion.ol>
      </motion.div>
    </div>
  )
})

/**
 * One task: how it stands, its number, its title, and its description cut to one quiet line, whole on hover (the user,
 * 2026-11-27: "the body is too long, just a trim version in a dark color is better, a 2px bigger title too"). Each rises
 * in after the one before as the list opens.
 */
function rowOf(task: AgentTask, index: number, tint: string | undefined, still: boolean): ReactElement {
  const delay = Math.min(index, 8) * 0.03
  return (
    <motion.li
      key={task.id}
      layout={still ? false : 'position'}
      transition={{ layout: spring.sheet }}
      initial={holdStill({ opacity: 0, transform: 'translateY(8px)' }, still)}
      animate={holdStill({ opacity: 1, transform: 'translateY(0px)', transition: { transform: { ...spring.rise, delay }, opacity: { ...tween.enter, delay } } }, still)}
      exit={{ opacity: 0, transition: tween.exit }}
      className="relative flex min-w-0 items-start gap-2.5 rounded-xl px-2 py-1.5 text-[13px] leading-snug"
    >
      {tint ? (
        <motion.span layoutId={tint} transition={still ? { duration: 0 } : spring.follow} className="absolute inset-0 rounded-xl bg-[color-mix(in_oklab,var(--tasks-tint)_14%,transparent)]" aria-hidden="true" />
      ) : null}
      <Mark state={task.state} still={still} />
      <span className="relative mt-px w-5 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums">{task.id}</span>
      <span className="relative flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className={cn('min-w-0 flex-1 text-[15px] break-words', task.state === 'done' && 'text-muted-foreground', task.state === 'now' && 'font-medium')}>{titleOf(task)}</span>
          <span className={cn('shrink-0 text-[11px] text-muted-foreground', task.state === 'now' && 'font-medium text-foreground')}>{STATE_WORDS[task.state]}</span>
        </span>
        {task.description ? (
          <span title={task.description} className="truncate text-[12px] text-muted-foreground/70">
            {task.description}
          </span>
        ) : null}
      </span>
    </motion.li>
  )
}

const MARK: Record<TaskState, string> = {
  done: 'bg-[var(--tasks-tint)]',
  now: 'shadow-[inset_0_0_0_1.5px_var(--tasks-tint)]',
  queued: 'shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--hb-border-strong)_70%,transparent)]',
}

/** How a task stands, in a mark: an empty ring waiting, a ring with a breathing dot now, filled with a check once done. */
function Mark({ state, still }: { state: TaskState; still: boolean }) {
  return (
    <span className="relative mt-px grid size-4 shrink-0 place-items-center" aria-hidden="true">
      <AnimatePresence initial={false}>
        <motion.span
          key={state}
          initial={holdStill({ opacity: 0, transform: 'scale(0.96)' }, still)}
          animate={holdStill({ opacity: 1, transform: 'scale(1)', transition: { transform: spring.alive, opacity: tween.enter } }, still)}
          exit={{ opacity: 0, transition: tween.exit }}
          className={cn('col-start-1 row-start-1 grid size-4 place-items-center rounded-full', MARK[state])}
        >
          {state === 'done' ? <Check className="size-2.5 text-background" strokeWidth={3.5} /> : state === 'now' ? <span className="aa-running size-1.5 rounded-full bg-[var(--tasks-tint)]" /> : null}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
