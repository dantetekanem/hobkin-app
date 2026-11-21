import { useEffect, useRef, useState } from 'react'

/** The least time between two changes of text being written on screen. A word slower than this shows as soon as it is whole. */
export const CADENCE_MS = 100

/**
 * What shows of text that is still being written: at most one change every CADENCE_MS, the first at once, so it grows
 * a few words at a time and is drawn ten times a second at most, however often it arrives. `next` says what shows next
 * of `text` given what shows now; by default all of it. Text that is not `live` shows whole at once.
 */
export function usePaced(text: string, live: boolean, next: (text: string, shown: string) => string = (all) => all): string {
  const [shown, setShown] = useState(() => (live ? next(text, '') : text))
  const last = useRef(0)
  const target = live ? next(text, shown) : text
  useEffect(() => {
    if (!live || target === shown) return
    const timer = setTimeout(() => {
      last.current = performance.now()
      setShown(target)
    }, Math.max(0, last.current + CADENCE_MS - performance.now()))
    return () => clearTimeout(timer)
  }, [live, target, shown])
  return live ? shown : text
}
