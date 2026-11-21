import { createStore, type StoreApi } from 'zustand/vanilla'

/** What a mirror needs of the page: its frames, a timer, a clock, and whether the page is hidden. Tests pass their own. */
export interface Pace {
  /** Runs `then` at the page's next animation frame. A hidden page may never run it. */
  frame: (then: () => void) => void
  timer: (then: () => void, ms: number) => void
  now: () => number
  hidden: () => boolean
}

/** A store that follows another one at a slower pace. */
export interface Mirror<State> {
  readonly store: StoreApi<State>
  /** The page shows again: a change it did not take yet, it takes now. */
  show(): void
  stop(): void
}

/** How long a mirror that follows frames waits for one before it takes the change anyway. */
export const NO_FRAME_MS = 100

/**
 * A store that holds what `source` holds, taken over at most once per animation frame (`every: 'frame'`) or once per
 * `every` milliseconds, and never while the page is hidden. It takes the source's own state, never a message, so no
 * message is lost or applied twice: what it holds is always a state the source had. The source keeps every listener
 * that must hear each change at once. A mirror that follows frames takes the change once a frame runs, or after
 * `NO_FRAME_MS` without one. One that follows a time takes it at once when that long has passed since it last did,
 * and otherwise when it has.
 */
export function mirrorStore<State>(source: Pick<StoreApi<State>, 'getState' | 'subscribe'>, pace: Pace, every: 'frame' | number): Mirror<State> {
  const store = createStore<State>(() => source.getState())
  /** The source changed since the store last took it. */
  let due = false
  /** The take that is waiting to run, or 0. A newer one, or a take that ran, makes an older one do nothing. */
  let waiting = 0
  let takes = 0
  let last = -Infinity

  const take = () => {
    waiting = 0
    if (pace.hidden()) return
    due = false
    last = pace.now()
    store.setState(source.getState(), true)
  }

  /** How long until the store may take again: never long for frames, and what is left of `every` for a time. */
  const untilAllowed = (): number => {
    if (every === 'frame') return 0
    const left = last + every - pace.now()
    return Math.min(every, Math.max(0, left))
  }

  const schedule = (atOnce: boolean) => {
    if (!due || waiting !== 0 || pace.hidden()) return

    const wait = untilAllowed()
    if (atOnce && wait === 0) return take()

    takes += 1
    const id = takes
    waiting = id
    const then = () => {
      if (waiting === id) take()
    }
    if (every === 'frame') {
      pace.frame(then)
      pace.timer(then, NO_FRAME_MS)
    } else {
      pace.timer(then, wait)
    }
  }

  const unsubscribe = source.subscribe(() => {
    due = true
    schedule(every !== 'frame')
  })
  return {
    store,
    show: () => {
      waiting = 0
      schedule(true)
    },
    stop: () => {
      waiting = 0
      unsubscribe()
    },
  }
}
