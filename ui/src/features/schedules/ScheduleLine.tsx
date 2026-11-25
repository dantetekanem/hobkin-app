import { Check, ChevronUp, Pause, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { useStore } from 'zustand'
import type { AgentSchedule, AgentScheduleState } from '#shared/protocol/schedules.ts'
import { inOverlay } from '@/app/key-page.ts'
import { holdStill, useStill } from '@/app/still.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
// The breathing dot of a running schedule is the tasks list's own (`aa-running`, on opacity), and so is its glow (`aa-glow`).
import '@/features/agent-activity/agent-activity.css'
import { liveIf } from '@/features/agent-activity/glow.ts'
import { useNow } from '@/features/chat/use-now.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { createScheduleActions, type ScheduleSend } from './actions.ts'
import { countWords, lineFit } from './line-fit.ts'
import { scheduleListKey, type ScheduleKeyPress } from './schedule-keys.ts'
import {
  doesWords,
  endedWords,
  everyWords,
  isEnded,
  isLive,
  lastRunWords,
  leftWords,
  nameOf,
  orderSchedules,
  ownerWords,
  placeKey,
  scheduleLine,
  schedulesGlow,
  stateOf,
  whenWords,
  type ScheduleLineWords,
  type SchedulePlace,
} from './schedules.ts'
import { useTextMeasure } from './text-measure.ts'
import { sendSchedule, useScheduleList, useSchedules } from './use-schedules.ts'

/** The line's room in the row under an agent's or a hobkin's talk box, beside the status words, kept with or without schedules. */
export const PAGE_ROOM = 'min(13rem, 46%)'

/** The list never covers the header above it, and has at least this much room. */
const LEAVE = 64
const LEAST_ROOM = 160

const pressOf = (event: { key: string; code: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean }): ScheduleKeyPress => ({
  key: event.key,
  code: event.code,
  ctrl: event.ctrlKey,
  alt: event.altKey,
  meta: event.metaKey,
  shift: event.shiftKey,
})

/**
 * Whether this line hears Control+Option+W. A page's line hears it while the keyboard is on that page and the page is
 * the one shown. The main chat's hears it everywhere else, and also on a page that keeps no schedule of its own.
 */
function takesKey(element: HTMLElement, main: boolean): boolean {
  if (element.closest('[inert]') || element.getClientRects().length === 0) return false
  const active = document.activeElement instanceof Element ? document.activeElement : null
  const pageWithKeyboard = active?.closest('[data-canvas-screen]') ?? null
  if (main) return !pageWithKeyboard?.querySelector('[data-schedule-line]')
  const page = element.closest<HTMLElement>('[data-canvas-screen]')
  if (!page || page !== pageWithKeyboard) return false
  return page.dataset.canvasScreen === document.querySelector<HTMLElement>('[data-active-canvas-screen]')?.dataset.activeCanvasScreen
}

/**
 * The schedules agents keep for themselves (`056-agent-schedules`), in one line near the input: with one, its name and
 * when it fires, "Watch CI in 1:42"; with more, how many and the next, "2 · Watch CI in 1:42"; while one runs its
 * command, that it runs. A press, Enter on it, or Control+Option+W opens every one above it, and the same again or
 * Escape closes it, with the keyboard back where it was. With none, nothing is drawn.
 *
 * Its room comes one of two ways. On a page the parent gives it a width (`style`) that is kept with or without
 * schedules. In the main chat's status row (`inRow`) the row gives it its width (`use-turn-room.ts`), none without a
 * schedule. Either way the parent is a positioned row, and the open list rises from that row's right end. The words
 * fit the room: the name and the countdown, then the count and the countdown, then the dot with the count, then the
 * dot alone (`line-fit.ts`).
 */
export function ScheduleLine({ place, className, style, inRow }: { place: SchedulePlace; className?: string; style?: CSSProperties; inRow?: { width: number } }) {
  const schedules = useSchedules(place)
  return <ScheduleLineView schedules={schedules} place={place} className={className} style={style} inRow={inRow} />
}

/** The line for given schedules, with no host: what `ScheduleLine` draws, and what a still render draws. */
export function ScheduleLineView({
  schedules,
  place,
  className,
  style,
  inRow,
  measured,
  send = sendSchedule,
}: {
  schedules: readonly AgentSchedule[]
  place: SchedulePlace
  className?: string
  style?: CSSProperties
  /** In the main chat's status row: the width the row gives it. */
  inRow?: { width: number }
  /** For a still render, which measures nothing: the line's own width on a page. */
  measured?: number
  send?: ScheduleSend
}) {
  const still = useStill()
  const key = placeKey(place)
  const ordered = useMemo(() => orderSchedules(schedules), [schedules])
  const any = ordered.length > 0
  const open = useScheduleList((state) => state.open === key) && any
  const root = useRef<HTMLDivElement>(null)
  const ownWidth = useOwnWidth(root, inRow !== undefined, measured)
  const lineWidth = inRow ? inRow.width : ownWidth
  // In the main chat the row's height is what stays kept. With no schedule the line takes no width, so the row is
  // what it was without one; with one it takes its room at the row's right end, where nothing was, and the bubble,
  // anchored at its left, is cut sooner. Nothing that can be pressed moves.
  const rootStyle = inRow ? { width: any ? lineWidth : 0, marginLeft: any ? 8 : 0 } : style
  const bar = useRef<HTMLButtonElement>(null)
  // Where the keyboard was when the list opened, to go back to as it closes, and whether a key opened it.
  const keyboardWasAt = useRef<HTMLElement | null>(null)
  const [openedByKey, setOpenedByKey] = useState(false)
  const panelId = useId()

  const openList = (byKey: boolean) => {
    const active = document.activeElement
    keyboardWasAt.current = active instanceof HTMLElement && active !== document.body ? active : null
    setOpenedByKey(byKey)
    useScheduleList.getState().setOpen(key, true)
  }

  const closeList = () => {
    const inside = root.current
    if (inside?.contains(document.activeElement)) {
      const before = keyboardWasAt.current
      const back = before?.isConnected && !inside.contains(before) ? before : bar.current
      back?.focus({ preventScroll: true })
    }
    useScheduleList.getState().setOpen(key, false)
  }

  const toggleByKey = () => (useScheduleList.getState().open === key ? closeList() : openList(true))
  const latestToggle = useRef(toggleByKey)
  latestToggle.current = toggleByKey

  // Control+Option+W reaches the list from anywhere its place has the keyboard, so it is heard on the window.
  useEffect(() => {
    if (!any) return
    const main = key === 'main'
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      if (scheduleListKey(pressOf(event), { open: false, inList: false }) !== 'toggle') return
      const element = root.current
      if (!element || !takesKey(element, main) || inOverlay(event.target, document)) return
      event.preventDefault()
      latestToggle.current()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [any, key])

  // A press anywhere else closes the open list, as a popover does.
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return
      useScheduleList.getState().setOpen(key, false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open, key])

  return (
    <div
      ref={root}
      data-schedule-line={any ? '' : undefined}
      className={cn('flex min-w-0 shrink-0 items-center justify-end', className)}
      style={rootStyle}
      onKeyDown={(event) => {
        if (scheduleListKey(pressOf(event), { open, inList: true }) !== 'close') return
        event.preventDefault()
        event.stopPropagation()
        closeList()
      }}
    >
      <AnimatePresence initial={false}>
        {any ? <LineButton key="line" ref={bar} schedules={ordered} width={lineWidth} open={open} panelId={panelId} still={still} onToggle={() => (open ? closeList() : openList(false))} /> : null}
      </AnimatePresence>
      <AnimatePresence>
        {open ? <SchedulePanel key="panel" id={panelId} schedules={ordered} main={place.kind === 'main'} still={still} takeKeyboard={openedByKey} send={send} /> : null}
      </AnimatePresence>
    </div>
  )
}

/**
 * The pressable line. It alone counts the seconds, and only while one of its schedules waits for its time. A line that
 * comes after the page opened rises in; one there already is simply there. Its border, in the color of its dot,
 * breathes while a schedule runs or is due now (`schedulesGlow`).
 */
function LineButton({
  ref,
  schedules,
  width,
  open,
  panelId,
  still,
  onToggle,
}: {
  ref: RefObject<HTMLButtonElement | null>
  schedules: readonly AgentSchedule[]
  width: number
  open: boolean
  panelId: string
  still: boolean
  onToggle: () => void
}) {
  const counting = schedules.some((schedule) => stateOf(schedule) === 'waiting' && schedule.nextAt)
  const now = useNow(counting)
  // At the name's weight, so nothing is measured short.
  const measure = useTextMeasure(ref, 500)
  const line = scheduleLine(schedules, now)
  if (!line) return null
  const fit = lineFit(width, line, measure)
  const live = schedulesGlow(schedules, now)
  return (
    <motion.button
      ref={ref}
      type="button"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      aria-label={`Schedules: ${line.text}. ${open ? 'Hide' : 'Show'} every schedule.`}
      title={line.text}
      onClick={onToggle}
      {...liveIf(live)}
      initial={holdStill({ opacity: 0, transform: 'translateY(4px) scale(0.96)' }, still)}
      animate={holdStill({ opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.rise, opacity: tween.enter } }, still)}
      exit={holdStill({ opacity: 0, transform: 'translateY(0px) scale(0.96)', transition: tween.exit }, still)}
      whileTap={holdStill({ transform: 'translateY(0px) scale(0.97)', transition: { duration: 0.14 } }, still)}
      style={{ transformOrigin: '100% 50%', '--aa-glow': 'var(--hb-code)' } as CSSProperties}
      className={cn(
        // Its paddings, gaps, dot and arrow are the ones line-fit.ts counts.
        'pressable aa-glow flex h-6 w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-full bg-surface-2 px-2 text-[12px] outline-none focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]',
        // At its narrowest only the dot is left, in the middle of a round button.
        fit.form === 'dot' && 'justify-center px-0',
      )}
    >
      <Dot lead={line.lead} />
      {fit.form === 'dot' ? null : fit.form === 'count' ? (
        <span className="text-muted-foreground tabular-nums">{line.count}</span>
      ) : (
        <LineWords line={line} name={fit.form === 'full' ? fit.name : null} />
      )}
      {fit.form === 'full' || (fit.form === 'compact' && fit.arrow) ? (
        <ChevronUp className={cn('ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)]', open && 'rotate-180')} aria-hidden="true" />
      ) : null}
    </motion.button>
  )
}

/** The line's words: with a name, the count, the name and when ("3 · Watch CI in 1:42"); with none, the count and the countdown ("3 · 1:42"). */
function LineWords({ line, name }: { line: ScheduleLineWords; name: string | null }) {
  // "2 paused" has no name to leave out.
  if (line.text === line.short) return <span className="min-w-0 truncate text-muted-foreground">{line.text}</span>
  const whenTone = line.lead === 'running' ? 'text-[var(--hb-code-fg)]' : 'text-muted-foreground'
  const clock = name === null && line.when.startsWith('in ') ? line.when.slice(3) : line.when
  return (
    <span className="flex min-w-0 items-baseline gap-1 tabular-nums">
      {line.count > 1 ? <span className="shrink-0 text-muted-foreground">{countWords(line)}</span> : null}
      {name === null ? null : <span className={'min-w-0 truncate font-medium'}>{name}</span>}
      <span className={cn('min-w-0 truncate', whenTone)}>{clock}</span>
    </span>
  )
}

const DOT: Record<ScheduleLineWords['lead'], string> = {
  waiting: 'bg-[var(--hb-code)]',
  running: 'aa-running bg-[var(--hb-code)]',
  paused: 'shadow-[inset_0_0_0_1.5px_var(--hb-code)]',
}

/** How the line's schedule stands, in a dot: filled while it waits, breathing while it runs, a ring while it is paused. */
function Dot({ lead }: { lead: ScheduleLineWords['lead'] }) {
  return <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', DOT[lead])} />
}

/** The line's own width on a page, read before the first paint and again as it is resized. A still render gives it. */
function useOwnWidth(element: RefObject<HTMLElement | null>, given: boolean, measured: number | undefined): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const node = element.current
    if (given || measured !== undefined || !node) return
    const read = () => setWidth(node.getBoundingClientRect().width)
    read()
    const sizes = new ResizeObserver(read)
    sizes.observe(node)
    return () => sizes.disconnect()
  }, [element, given, measured])
  return measured ?? width
}

/** How tall the open list may be: from the row it rises from up to a little under the top of its side of the window. */
function useRoomAbove(element: RefObject<HTMLElement | null>): number | undefined {
  const [room, setRoom] = useState<number>()
  useLayoutEffect(() => {
    const node = element.current
    const row = node?.offsetParent
    if (!node || !row) return
    const area = node.closest('[data-chat-side], [data-canvas-screen]')
    const measure = () => {
      const areaTop = area?.getBoundingClientRect().top ?? 0
      const rowTop = row.getBoundingClientRect().top
      setRoom(Math.max(LEAST_ROOM, Math.round(rowTop - areaTop - LEAVE)))
    }
    measure()
    addEventListener('resize', measure)
    return () => removeEventListener('resize', measure)
  }, [element])
  return room
}

/**
 * Every schedule, live ones first and then those that ended lately, above the line. It rises from the line's end and
 * spans its row. Opened by a key, it takes the keyboard, so Tab walks its controls and Escape gives it back.
 */
const SchedulePanel = memo(function SchedulePanel({ id, schedules, main, still, takeKeyboard, send }: { id: string; schedules: readonly AgentSchedule[]; main: boolean; still: boolean; takeKeyboard: boolean; send: ScheduleSend }) {
  const outer = useRef<HTMLDivElement>(null)
  const room = useRoomAbove(outer)
  const live = schedules.filter(isLive)
  const ended = schedules.filter(isEnded)
  // The countdowns, the times ago and what is left move once a second, and only while one is live.
  const now = useNow(live.length > 0)
  useEffect(() => {
    if (takeKeyboard) outer.current?.focus({ preventScroll: true })
  }, [takeKeyboard])
  const counts = ended.length ? `${live.length} live · ${ended.length} ended` : `${live.length} live`

  return (
    <motion.div
      ref={outer}
      id={id}
      role="region"
      aria-label="Schedules"
      tabIndex={-1}
      style={{ maxHeight: room, transformOrigin: '100% 100%' }}
      initial={holdStill({ opacity: 0, transform: 'translateY(6px) scale(0.97)' }, still)}
      animate={holdStill({ opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.sheet, opacity: tween.enter } }, still)}
      exit={holdStill({ opacity: 0, transform: 'translateY(4px) scale(0.97)', transition: tween.exit }, still)}
      className="absolute right-0 bottom-full z-30 mb-2 flex w-[min(30rem,100%)] flex-col overflow-hidden rounded-[18px] border border-border bg-popover text-left text-popover-foreground shadow-panel outline-none"
    >
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-1.5">
        <span className="text-[13px] font-medium">Schedules</span>
        <span className="min-w-0 truncate text-[12px] text-muted-foreground tabular-nums">{counts}</span>
        <Kbd className="ml-auto">⌃⌥W</Kbd>
      </div>
      <ul aria-label="Schedules, running ones first, then the soonest" className="scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        {live.map((schedule, index) => (
          <ScheduleRow key={schedule.id} schedule={schedule} now={now} main={main} index={index} still={still} send={send} />
        ))}
        {ended.length ? <li className="px-2 pt-2 pb-0.5 text-[11px] font-medium text-muted-foreground">Ended lately</li> : null}
        {ended.map((schedule, index) => (
          <ScheduleRow key={schedule.id} schedule={schedule} now={now} main={main} index={live.length + index} still={still} send={send} />
        ))}
      </ul>
    </motion.div>
  )
})

const WHEN_TONE: Partial<Record<AgentScheduleState, string>> = { running: 'text-[var(--hb-code-fg)] font-medium', waiting: 'text-foreground', failed: 'text-bad-fg' }
const LAST_TONE = { ok: 'text-ok-fg', bad: 'text-bad-fg', quiet: 'text-foreground' } as const

/**
 * One schedule: its name and owner, what it does, when it fires next, how often, what its last run found and what it
 * has left, or why it ended. A live one has Run now, Pause or Resume, and Cancel, which asks in place. Each rises in
 * after the one before as the list opens.
 */
function ScheduleRow({ schedule, now, main, index, still, send }: { schedule: AgentSchedule; now: number; main: boolean; index: number; still: boolean; send: ScheduleSend }) {
  const state = stateOf(schedule)
  const ended = isEnded(schedule)
  const does = doesWords(schedule)
  const last = lastRunWords(schedule, now)
  // How often it fires and what it has left, or, once it ended, why.
  const course = ended ? `ended · ${endedWords(schedule)}` : [everyWords(schedule.every), leftWords(schedule, now)].filter(Boolean).join(' · ')
  const delay = Math.min(index, 8) * 0.03
  return (
    <motion.li
      initial={holdStill({ opacity: 0, transform: 'translateY(8px)' }, still)}
      animate={holdStill({ opacity: 1, transform: 'translateY(0px)', transition: { transform: { ...spring.rise, delay }, opacity: { ...tween.enter, delay } } }, still)}
      className="flex min-w-0 items-start gap-2.5 rounded-xl px-2 py-2 text-[12px] leading-snug"
    >
      <Mark state={state} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className={cn('min-w-0 truncate text-[13px] font-medium', ended && 'text-muted-foreground')}>{nameOf(schedule)}</span>
          {main ? <span className="min-w-0 flex-1 truncate text-muted-foreground">{ownerWords(schedule)}</span> : <span className="flex-1" />}
          <span className={cn('shrink-0 tabular-nums text-muted-foreground', WHEN_TONE[state])}>{whenWords(schedule, now)}</span>
        </div>
        {does.kind === 'command' ? (
          <code title={schedule.command} className="mt-0.5 block min-w-0 truncate font-mono text-[11.5px] text-foreground/85">
            {does.text}
          </code>
        ) : (
          <span className="line-clamp-2 break-words text-muted-foreground">
            <span className="text-foreground">wakes</span>
            {does.text ? ` · ${does.text}` : ''}
          </span>
        )}
        <span className="truncate text-muted-foreground tabular-nums">{course}</span>
        <span className="truncate text-muted-foreground tabular-nums">
          last: <span className={LAST_TONE[last.tone]}>{last.outcome}</span>
          {last.detail ? ` · ${last.detail}` : ''}
        </span>
        {ended ? null : <RowControls id={schedule.id} state={state} send={send} />}
      </div>
    </motion.li>
  )
}

/**
 * Run now, Pause or Resume, and Cancel. Each keeps its width whatever it says: Pause and Resume share one place, and
 * Cancel turns into "Click again to confirm" in its own, going back after ten seconds. A refusal shows under them.
 */
function RowControls({ id, state, send }: { id: string; state: AgentScheduleState; send: ScheduleSend }) {
  const [actions] = useState(() => createScheduleActions({ id, send }))
  useEffect(() => () => actions.dispose(), [actions])
  const { armed, busy, refused } = useStore(actions)
  const paused = state === 'paused'
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="xs" variant="outline" disabled={state === 'running'} aria-busy={busy === 'run'} onClick={() => void actions.press('run')}>
          Run now
        </Button>
        <Button size="xs" variant="outline" aria-busy={busy === 'pause' || busy === 'resume'} onClick={() => void actions.press(paused ? 'resume' : 'pause')}>
          <Stacked shown={paused ? 1 : 0} labels={['Pause', 'Resume']} />
        </Button>
        <Button
          size="xs"
          variant="outline"
          aria-pressed={armed}
          aria-busy={busy === 'cancel'}
          onClick={() => void actions.press('cancel')}
          className={cn(armed && 'border-destructive/50 text-destructive hover:text-destructive')}
        >
          <Stacked shown={armed ? 1 : 0} labels={['Cancel', 'Click again to confirm']} />
        </Button>
      </div>
      {refused ? (
        <p role="alert" className="text-[12px] break-words text-bad-fg">
          {refused}
        </p>
      ) : null}
    </div>
  )
}

/** Words that take turns in one place, as wide as the widest, so the button never changes size. Only the one shown is read. */
function Stacked({ shown, labels }: { shown: number; labels: readonly string[] }) {
  return (
    <span className="grid justify-items-center">
      {labels.map((label, index) => (
        <span
          key={label}
          aria-hidden={index !== shown}
          className={cn('col-start-1 row-start-1 transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]', index !== shown && 'opacity-0')}
        >
          {label}
        </span>
      ))}
    </span>
  )
}

const RING = 'shadow-[inset_0_0_0_1.5px_var(--hb-code)]'
const QUIET_RING = 'shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--hb-border-strong)_70%,transparent)]'

const MARK_RING: Record<AgentScheduleState, string> = {
  waiting: RING,
  running: RING,
  paused: RING,
  done: 'bg-[var(--hb-code)]',
  cancelled: QUIET_RING,
  expired: QUIET_RING,
  failed: QUIET_RING,
}

/** How a schedule stands, in a mark beside it, as the tasks list marks its tasks: a dot that waits or breathes, a pause, a check or a cross. */
function Mark({ state }: { state: AgentScheduleState }) {
  return (
    <span aria-hidden="true" className={cn('mt-px grid size-4 shrink-0 place-items-center rounded-full', MARK_RING[state])}>
      <MarkInside state={state} />
    </span>
  )
}

function MarkInside({ state }: { state: AgentScheduleState }) {
  switch (state) {
    case 'waiting':
      return <span className="size-1.5 rounded-full bg-[var(--hb-code)]" />
    case 'running':
      return <span className="aa-running size-1.5 rounded-full bg-[var(--hb-code)]" />
    case 'paused':
      return <Pause className="size-2 fill-current text-[var(--hb-code)]" strokeWidth={0} />
    case 'done':
      return <Check className="size-2.5 text-background" strokeWidth={3.5} />
    case 'failed':
      return <X className="size-2.5 text-bad-fg" strokeWidth={3} />
    default:
      return null
  }
}
