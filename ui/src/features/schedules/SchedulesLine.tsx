import { useEffect, useMemo, useRef, type RefObject } from 'react'
import type { AgentSchedule } from '#shared/protocol/schedules.ts'
import { inOverlay } from '@/app/key-page.ts'
import { useStill } from '@/app/still.ts'
import { useDrop } from '@/features/agent-activity/drop.ts'
import { useWakeAt } from '@/features/chat/use-now.ts'
import { FoldLine, type FoldList } from '@/features/teams/FoldLine.tsx'
import { cn } from '@/lib/utils.ts'
import type { ScheduleSend } from './actions.ts'
import { SCHEDULES_ORDER, ScheduleRows } from './ScheduleLine.tsx'
import { scheduleListKey } from './schedule-keys.ts'
import { listCounts, nextDueAt, orderSchedules, placeOfAgent, scheduleLine, schedulesCount, schedulesGlow, type ScheduleLineWords } from './schedules.ts'
import { sendSchedule, useSchedules } from './use-schedules.ts'

/**
 * An agent's schedules (`056-agent-schedules`) as one of the lines under its header, beside its tasks and helpers: a
 * dot and how many, "2 schedules", its border breathing while one runs or is due. A press, Enter on it, or
 * Control+Option+W opens every one under it, with what each does, when it runs next and its controls, and the same
 * again or Escape closes it. hobkin keeps these schedules and the agent made them with hobkin's own tool. Nothing shows
 * while none is live. `agentId` names the agent as the window does (`placeOfAgent`).
 *
 * Mount it in the lines' positioned row (`AgentLines.tsx`): the open list hangs from that row, under the line.
 */
export function SchedulesLine({ agentId, hue, className }: { agentId: string; hue: number; className?: string }) {
  const place = useMemo(() => placeOfAgent(agentId), [agentId])
  return <SchedulesLineView schedules={useSchedules(place)} hue={hue} main={place.kind === 'main'} className={className} />
}

/** The line for given schedules, with no host: what `SchedulesLine` draws, and what a still render draws. */
export function SchedulesLineView({ schedules, hue, main, className, send = sendSchedule }: { schedules: readonly AgentSchedule[]; hue: number; main: boolean; className?: string; send?: ScheduleSend }) {
  const still = useStill()
  const root = useRef<HTMLDivElement>(null)
  const ordered = useMemo(() => orderSchedules(schedules), [schedules])
  const now = Date.now()
  const line = scheduleLine(ordered, now)
  const count = schedulesCount(ordered)
  // It draws again when the soonest comes due, to glow, and ticks for nothing else.
  useWakeAt(nextDueAt(ordered, now))
  useScheduleKey(root, line !== null)

  if (line === null || count === null) return null

  const list: FoldList = {
    title: 'Schedules',
    counts: listCounts(ordered),
    label: SCHEDULES_ORDER,
    keys: '⌃⌥W',
    rows: <ScheduleRows schedules={ordered} main={main} still={still} send={send} />,
  }
  return (
    // Marked, so the main chat's line leaves Control+Option+W to this page while it has the keyboard.
    <div ref={root} data-schedule-line className={cn('flex min-w-0', className)}>
      <FoldLine
        drop="schedules"
        faces={[{ key: 'dot', face: <Dot lead={line.lead} /> }]}
        count={count}
        summary={`${count}: ${line.text}`}
        live={schedulesGlow(ordered, now)}
        hue={hue}
        list={list}
      />
    </div>
  )
}

const DOT: Record<ScheduleLineWords['lead'], string> = {
  waiting: 'bg-[var(--hb-code)]',
  running: 'aa-running bg-[var(--hb-code)]',
  paused: 'shadow-[inset_0_0_0_1.5px_var(--hb-code)]',
}

/** How the soonest stands, in a dot: filled while it waits, breathing while it runs, a ring while every one is paused. */
function Dot({ lead }: { lead: ScheduleLineWords['lead'] }) {
  return <span aria-hidden="true" className={cn('mx-0.5 block size-2 rounded-full', DOT[lead])} />
}

/**
 * Control+Option+W opens and closes the list while the keyboard is on this page and the page is the one shown, the
 * page's talk box included. Opened by the key, the list takes the keyboard, so Tab walks its controls and Escape gives
 * it back to the line.
 */
function useScheduleKey(root: RefObject<HTMLDivElement | null>, any: boolean) {
  useEffect(() => {
    if (!any) return
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      const press = {
        key: event.key,
        code: event.code,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        meta: event.metaKey,
        shift: event.shiftKey,
      }
      if (scheduleListKey(press, { open: false, inList: false }) !== 'toggle') return
      const element = root.current
      if (!element || !onShownPage(element) || inOverlay(event.target, document)) return

      event.preventDefault()
      toggleByKey(element)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [root, any])
}

/** Opens the list with the keyboard in it, or closes it with the keyboard back on the line when it was inside. */
function toggleByKey(line: HTMLElement) {
  const drop = useDrop.getState()
  if (drop.open === 'schedules') {
    if (line.contains(document.activeElement)) line.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
    drop.setOpen('schedules', false)
    return
  }
  drop.setOpen('schedules', true)
  requestAnimationFrame(() => line.querySelector<HTMLElement>('[role="region"]')?.focus({ preventScroll: true }))
}

/** The line is on the page shown, not one on its way out, and the keyboard is on that page. */
function onShownPage(element: HTMLElement): boolean {
  if (element.closest('[inert]')) return false
  const page = element.closest<HTMLElement>('[data-canvas-screen]')
  const active = document.activeElement instanceof Element ? document.activeElement : null
  if (!page || active?.closest('[data-canvas-screen]') !== page) return false
  return page.dataset.canvasScreen === document.querySelector<HTMLElement>('[data-active-canvas-screen]')?.dataset.activeCanvasScreen
}
