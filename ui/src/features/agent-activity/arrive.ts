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

/** The class a row takes: the entrance when it came after its list was drawn, none when it was drawn with it. */
export function useArrival(): string | undefined {
  const drawn = useContext(Drawn)
  const [arrives] = useState(() => drawn.current)
  return arrives ? 'aa-arrive' : undefined
}
