import { createContext, createElement, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * How a row of the transcript arrives (agent-activity.css, `.aa-arrive`): one drawn with the transcript is simply there,
 * and one that comes after it fades in as it moves up from just below. Nothing leaves with a motion: a row that goes is
 * gone at once.
 */

/** Whether the list around a row has been drawn. Outside any list, nothing arrives. */
const Drawn = createContext<{ readonly current: boolean }>({ current: false })

/** A list of the transcript, or a group within a step: the rows it is drawn with are there, and later ones arrive. */
export function Arrivals({ children }: { children?: ReactNode }) {
  const drawn = useRef(false)
  useEffect(() => {
    drawn.current = true
  }, [])
  return createElement(Drawn.Provider, { value: drawn }, children)
}

const ARRIVES = { current: true }
const STAYS = { current: false }

/**
 * One row of a windowed list (`windowed-list.tsx`), which draws a row again each time it scrolls back into view: it
 * arrives only when `arrives`, decided by its key (`windowed-rows.ts` FreshKeys), never because it was drawn again. A
 * list or group inside the row arrives as it would anywhere.
 */
export function ArriveAs({ arrives, children }: { arrives: boolean; children?: ReactNode }) {
  return createElement(Drawn.Provider, { value: arrives ? ARRIVES : STAYS }, children)
}

/** The class a row takes: the entrance when it came after its list was drawn, none when it was drawn with it. */
export function useArrival(): string | undefined {
  const drawn = useContext(Drawn)
  const [arrives] = useState(() => drawn.current)
  return arrives ? 'aa-arrive' : undefined
}
