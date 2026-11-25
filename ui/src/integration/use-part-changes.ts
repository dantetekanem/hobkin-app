import { useEffect, useReducer } from 'react'
import { windowParts } from './registry.ts'

/**
 * A count that moves each time a part says something its `home` or `spotlight` reads besides its slice has changed
 * (`WindowPart.subscribe`). A memo that reads the parts names it among what it follows. The parts are fixed once the
 * window has started.
 */
export function usePartChanges(): number {
  const [count, moved] = useReducer((at: number) => at + 1, 0)
  useEffect(() => {
    const stops = windowParts().flatMap((part) => (part.subscribe ? [part.subscribe(() => moved())] : []))
    return () => {
      for (const stop of stops) stop()
    }
  }, [])
  return count
}
