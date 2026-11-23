import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { quietRoom, turnRoom } from './line-fit.ts'
import { isLive, type SchedulePlace } from './schedules.ts'
import { useTextMeasure } from './text-measure.ts'
import { useSchedules } from './use-schedules.ts'

const HOME: SchedulePlace = { kind: 'main' }

/** The bubble's padding and border around its words (`SpeechBubble.tsx`), and the gap between the row's parts. */
const BUBBLE_FRAME = 22
const GAP = 8

export interface TurnRoom {
  /** The status row, whose width is measured. */
  row: RefObject<HTMLDivElement | null>
  /** What sits at the row's right while a turn runs: the working line or the elapsed time, and "esc esc stops". */
  keeps: RefObject<HTMLSpanElement | null>
  /** The schedules line's width: none without a schedule. */
  line: number
  /** For the part of the row the bubble is in: what the bubble leaves at its right while a turn runs beside a schedule. */
  reserve: CSSProperties | undefined
}

/**
 * The main chat's status row shared with the schedules line (`line-fit.ts`). With no schedule the line takes nothing and
 * the row is as it always was. With one, while the row is quiet, the line takes its whole room; while a turn runs, the
 * working line and the stop keys keep theirs, the line takes the widest form that fits, and the bubble the rest. The
 * row is measured only while a schedule exists, and what is at its right only while a turn runs beside one.
 */
export function useTurnRoom({ crowded, givesWay, doing }: { crowded: boolean; givesWay: boolean; doing: string }): TurnRoom {
  const row = useRef<HTMLDivElement>(null)
  const keeps = useRef<HTMLSpanElement>(null)
  const schedules = useSchedules(HOME)
  const any = schedules.length > 0
  const rowWidth = useWidth(row, any)
  const { natural, least } = useNaturalWidth(keeps, any && crowded)
  const measure = useTextMeasure(row, 400, '12px')

  if (!any) return { row, keeps, line: 0, reserve: undefined }
  if (!crowded) return { row, keeps, line: quietRoom(rowWidth), reserve: undefined }

  const room = turnRoom({
    row: rowWidth,
    natural,
    least,
    bubble: doing ? measure(doing) + BUBBLE_FRAME : 0,
    givesWay,
    count: schedules.filter(isLive).length,
  })
  return { row, keeps, line: room.line, reserve: { '--status-reserve': `${room.reserve}px` } as CSSProperties }
}

/** The element's width while `active`, read before the first paint and again as it is resized. */
function useWidth(element: RefObject<HTMLElement | null>, active: boolean): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const node = element.current
    if (!active || !node) return
    const read = () => setWidth(node.getBoundingClientRect().width)
    read()
    const sizes = new ResizeObserver(read)
    sizes.observe(node)
    return () => sizes.disconnect()
  }, [element, active])
  return width
}

/**
 * The width the element's parts would take uncut, and the least they can take, where a part that cuts its words (the
 * working line) can go to nothing, with the gaps between them, while `active`: read again when their words change, as
 * the working line's do every second, or when the element is resized.
 */
function useNaturalWidth(element: RefObject<HTMLElement | null>, active: boolean): { natural: number; least: number } {
  const [natural, setNatural] = useState(0)
  const [least, setLeast] = useState(0)
  useLayoutEffect(() => {
    const node = element.current
    if (!active || !node) return
    const read = () => {
      const parts = [...node.children]
      const gaps = GAP * Math.max(0, parts.length - 1)
      const uncut = parts.reduce((total, part) => total + part.scrollWidth, 0)
      const fixed = parts.reduce((total, part) => total + (getComputedStyle(part).overflowX === 'hidden' ? 0 : part.scrollWidth), 0)
      setNatural(Math.ceil(uncut + gaps))
      setLeast(Math.ceil(fixed + gaps))
    }
    read()
    const words = new MutationObserver(read)
    words.observe(node, { subtree: true, childList: true, characterData: true })
    const sizes = new ResizeObserver(read)
    sizes.observe(node)
    return () => {
      words.disconnect()
      sizes.disconnect()
    }
  }, [element, active])
  return { natural, least }
}
