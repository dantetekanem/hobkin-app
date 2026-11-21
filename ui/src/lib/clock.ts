/**
 * The window's clocks. Everything that shows the time at one pace (every second, every half minute) shares one timer,
 * so its texts move together in one draw instead of each on its own timer. A pace runs only while something shows it
 * and the window is in sight: hidden, nothing ticks, and on its return every clock that is shown reads the time at once.
 */

interface Pace {
  /** The time this pace last read. */
  now: number
  listeners: Set<() => void>
  timer: ReturnType<typeof setInterval> | null
}

// The paces live on globalThis, so a hot update that runs this file again keeps the running timers and their readers
// instead of starting a second set beside them. The page listener is added once, by the first copy.
const holder = globalThis as { __hobkinClocks?: Map<number, Pace> }
const first = holder.__hobkinClocks === undefined
const paces = (holder.__hobkinClocks ??= new Map<number, Pace>())

/** A reading older than this is read again when asked for, so what mounts between ticks starts from the time now. */
const FRESH_MS = 1000

const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

function paceOf(everyMs: number): Pace {
  let pace = paces.get(everyMs)
  if (!pace) paces.set(everyMs, (pace = { now: Date.now(), listeners: new Set(), timer: null }))
  return pace
}

function tick(pace: Pace): void {
  pace.now = Date.now()
  for (const listener of [...pace.listeners]) listener()
}

function run(everyMs: number, pace: Pace): void {
  if (pace.timer !== null || pace.listeners.size === 0 || hidden()) return
  pace.timer = setInterval(() => tick(pace), everyMs)
}

function halt(pace: Pace): void {
  if (pace.timer !== null) clearInterval(pace.timer)
  pace.timer = null
}

/** Calls `listener` at each tick of this pace, from now until the returned function is called. */
export function subscribeClock(everyMs: number, listener: () => void): () => void {
  const pace = paceOf(everyMs)
  pace.listeners.add(listener)
  run(everyMs, pace)
  return () => {
    pace.listeners.delete(listener)
    if (pace.listeners.size === 0) halt(pace)
  }
}

/** The time at this pace: the same value until its next tick, read again first if it is over a second old. */
export function readClock(everyMs: number): number {
  const pace = paceOf(everyMs)
  if (Date.now() - pace.now >= Math.min(everyMs, FRESH_MS)) pace.now = Date.now()
  return pace.now
}

if (first && typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    for (const [everyMs, pace] of paces) {
      if (hidden()) halt(pace)
      else if (pace.listeners.size > 0 && pace.timer === null) {
        tick(pace)
        run(everyMs, pace)
      }
    }
  })
}
