import { useCallback, useSyncExternalStore } from 'react'
import { readClock, subscribeClock } from '../../lib/clock.ts'

const still = () => () => {}

/**
 * The current time, read again every `everyMs` while `active`. For clocks on screen: elapsed time, a reaction that ends,
 * the day. Everything at one pace shares the window's one clock for it (`lib/clock.ts`), which stops while the window
 * is hidden. Call it in the smallest part that shows the time: everything the caller draws draws again at each tick.
 */
export function useNow(active: boolean, everyMs = 1000): number {
  const subscribe = useCallback((listener: () => void) => (active ? subscribeClock(everyMs, listener) : still()), [active, everyMs])
  const read = () => readClock(everyMs)
  return useSyncExternalStore(subscribe, read, read)
}
