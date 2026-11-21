import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import { METRICS_DAYS_DEFAULT, type WorkMetrics } from '#shared/protocol/metrics.ts'
import { hostStore, runCommand, useHasHost } from '@/lib/host/index.ts'
import { createMetricsStore, periodOf, type MetricsRead, type MetricsStore } from './metrics-store.ts'
import { sampleMetrics } from './sample-metrics.ts'

export { READ_WORDS, type MetricsRead, type MetricsReadState } from './metrics-store.ts'

/**
 * `work.metrics` joins the command registry with the host's side of spec 053 (S2). Until then the window sends it by
 * name, and a host that does not know it refuses it by name, which reads as "this host sends no numbers yet".
 */
const readMetrics = (days: number): Promise<WorkMetrics> => (runCommand as unknown as (name: string, args: { days: number }) => Promise<WorkMetrics>)('work.metrics', { days })

const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
const connected = () => hostStore.getState().link === 'open'

function makeStore(): MetricsStore {
  const made = createMetricsStore(
    {
      read: readMetrics,
      now: Date.now,
      after: (ms, run) => {
        const timer = setTimeout(run, ms)
        return () => clearTimeout(timer)
      },
    },
    visible() && connected(),
  )
  const follow = () => made.setReady(visible() && connected())
  hostStore.subscribe(follow)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', follow)
  return made
}

// The store and its two listeners are made once and live on globalThis, as the clocks do (`lib/clock.ts`): a hot
// update that runs this file again finds the running store instead of making a second one beside it. Vite 8 has no
// `decline`. A change to the store's rules shows after the window reloads.
const holder = globalThis as { __hobkinMetrics?: MetricsStore }
const store = (holder.__hobkinMetrics ??= makeStore())

const NO_SUBSCRIPTION = () => () => {}

/**
 * Work's numbers for the last `days` local days (30 unless asked, 180 at most). With a host they are read with
 * `work.metrics` when first used and again at most once a minute while something that uses them is mounted and the
 * window is in sight; every page asking for the same days shares one read. Without a host, the sample. A host older
 * than the command gives the state `older-host`, with no numbers. While a new period is first read, the numbers of
 * the period before stay, with the state `loading`, so a page can hold them dimmed instead of emptying.
 */
export function useWorkMetrics(days: number = METRICS_DAYS_DEFAULT): MetricsRead {
  const live = useHasHost()
  const period = periodOf(days)
  const subscribe = useCallback((listener: () => void) => (live ? store.subscribe(period, listener) : NO_SUBSCRIPTION()), [live, period])
  const read = useSyncExternalStore(subscribe, () => store.get(period))
  const [shown, setShown] = useState<WorkMetrics | null>(null)
  if (read.metrics && read.metrics !== shown) setShown(read.metrics)
  const held = read.state === 'loading' && !read.metrics ? shown : null
  const sample = useMemo<MetricsRead | null>(() => (live ? null : { metrics: sampleMetrics(period), state: 'sample' }), [live, period])
  const holding = useMemo<MetricsRead | null>(() => (held ? { metrics: held, state: 'loading' } : null), [held])
  return sample ?? holding ?? read
}
