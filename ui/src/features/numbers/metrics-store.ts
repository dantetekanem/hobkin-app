import { METRICS_DAYS_MAX, type WorkMetrics } from '#shared/protocol/metrics.ts'

/**
 * The window's reads of `work.metrics` (_specs/053-work-control-room, "Numbers"). Each period is one read that every
 * page using it shares: it is read when first used, and again at most once a minute while something uses it and the
 * window can read (it is in sight and the host is connected). A read that says the same as the last keeps the numbers
 * held, so nothing is drawn again. The host, the clock and the timers are handed in, so a test can be the host.
 */

/** How often the numbers are read again while they are used. The host keeps its last fold this long. */
export const METRICS_EVERY_MS = 60_000

/**
 * Where a read stands. `sample`: no host, so the sample. `loading`: not answered yet. `ready`: the host's numbers.
 * `older-host`: the host does not know `work.metrics`, so it sends no numbers yet. `failed`: the last read failed;
 * the numbers read before it, if any, stay.
 */
export type MetricsReadState = 'sample' | 'loading' | 'ready' | 'older-host' | 'failed'

export interface MetricsRead {
  metrics: WorkMetrics | null
  state: MetricsReadState
}

/** What a page can say about a read that holds no numbers of its own. */
export const READ_WORDS: Record<MetricsReadState, string | null> = {
  sample: 'Sample numbers. No host is running.',
  loading: 'Reading the numbers…',
  ready: null,
  'older-host': 'This host sends no numbers yet.',
  failed: 'The numbers could not be read.',
}

export interface MetricsSource {
  /** Asks the host for the numbers of the last `days` days. */
  read: (days: number) => Promise<WorkMetrics>
  now: () => number
  /** Runs `run` once after `ms`; the function it returns cancels it. */
  after: (ms: number, run: () => void) => () => void
}

export interface MetricsStore {
  /** Holds the period's numbers in use, so they are read and kept fresh, until the returned function is called. */
  subscribe: (days: number, listener: () => void) => () => void
  /** The period's read as it stands. The same object until it changes. */
  get: (days: number) => MetricsRead
  /** Whether the window can read now: it is in sight and the host is connected. */
  setReady: (ready: boolean) => void
}

/** A host older than `work.metrics` refuses it by name (`unknown-command`, `lib/host/refusal.ts`). */
export function isOlderHost(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'unknown-command'
}

/** The days a read asks for: a whole number from 1 to 180. */
export const periodOf = (days: number): number => Math.min(METRICS_DAYS_MAX, Math.max(1, Math.round(Number.isFinite(days) ? days : 1)))

/** Two folds say the same when everything but the time they were folded at is the same. */
function sameMetrics(a: WorkMetrics, b: WorkMetrics): boolean {
  return JSON.stringify({ ...a, at: '' }) === JSON.stringify({ ...b, at: '' })
}

const LOADING: MetricsRead = Object.freeze({ metrics: null, state: 'loading' })

interface Entry {
  days: number
  read: MetricsRead
  listeners: Set<() => void>
  /** When the last read was asked for, or null before the first. */
  askedAt: number | null
  asking: boolean
  cancel: (() => void) | null
}

export function createMetricsStore(source: MetricsSource, ready = true): MetricsStore {
  const entries = new Map<number, Entry>()
  let canRead = ready

  const entryOf = (days: number): Entry => {
    let entry = entries.get(days)
    if (!entry) entries.set(days, (entry = { days, read: LOADING, listeners: new Set(), askedAt: null, asking: false, cancel: null }))
    return entry
  }

  const settle = (entry: Entry, read: MetricsRead) => {
    if (read.state === entry.read.state && read.metrics === entry.read.metrics) return
    entry.read = read
    for (const listener of [...entry.listeners]) listener()
  }

  const stopTimer = (entry: Entry) => {
    entry.cancel?.()
    entry.cancel = null
  }

  /** Reads now when a read is due, or waits for the minute to pass; does nothing while unused, unready or asking. */
  function keep(entry: Entry) {
    stopTimer(entry)
    if (entry.listeners.size === 0 || !canRead || entry.asking) return
    const due = entry.askedAt === null ? 0 : entry.askedAt + METRICS_EVERY_MS - source.now()
    if (due > 0) entry.cancel = source.after(due, () => keep(entry))
    else ask(entry)
  }

  function ask(entry: Entry) {
    entry.asking = true
    entry.askedAt = source.now()
    source.read(entry.days).then(
      (metrics) => {
        const held = entry.read.metrics
        settle(entry, { metrics: held && sameMetrics(held, metrics) ? held : metrics, state: 'ready' })
      },
      (error: unknown) => settle(entry, isOlderHost(error) ? { metrics: null, state: 'older-host' } : { metrics: entry.read.metrics, state: 'failed' }),
    ).finally(() => {
      entry.asking = false
      keep(entry)
    })
  }

  return {
    subscribe(days, listener) {
      const entry = entryOf(periodOf(days))
      entry.listeners.add(listener)
      keep(entry)
      return () => {
        entry.listeners.delete(listener)
        if (entry.listeners.size === 0) stopTimer(entry)
      }
    },
    get: (days) => entries.get(periodOf(days))?.read ?? LOADING,
    setReady(next) {
      if (next === canRead) return
      canRead = next
      for (const entry of entries.values()) keep(entry)
    },
  }
}
