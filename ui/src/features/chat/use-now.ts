import { useCallback, useEffect, useReducer, useSyncExternalStore } from 'react'
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

/**
 * Draws the caller again at `at`, for what changes at one known moment, such as a reaction that ends or a turn that
 * becomes long: nothing ticks in between. The caller reads the time itself as it draws. Null waits for nothing.
 */
export function useWakeAt(at: number | null): void {
  const [woken, wake] = useReducer((count: number) => count + 1, 0)
  useEffect(() => {
    if (at === null) return
    // One past the moment, and set again after each wake, so a timer that fires early cannot leave the caller behind.
    const timer = setTimeout(wake, Math.max(0, at - Date.now()) + 1)
    return () => clearTimeout(timer)
  }, [at, woken])
}

const MINUTE_MS = 60_000
const watchMinutes = (listener: () => void) => subscribeClock(MINUTE_MS, listener)
const today = () => new Date(readClock(MINUTE_MS)).setHours(0, 0, 0, 0)

/** When today began, on this Mac's clock: for day labels. It looks each minute and draws its caller only when the day turns. */
export function useToday(): number {
  return useSyncExternalStore(watchMinutes, today, today)
}
