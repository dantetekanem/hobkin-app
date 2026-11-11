import { filterReports, newestFirst, type Inbox, type ReportFilter } from './inbox.ts'

interface Selection extends ReportFilter {
  ready: boolean
  inbox: Inbox
  openId: string | null
  selectionRevision: number
  open: (id: string) => void
}

/** One mounted Reports visit; explicit choices and restoration always take precedence. */
export function visitReports(read: () => Selection, subscribe: (changed: () => void) => () => void): () => void {
  const revision = read().selectionRevision
  let pending = read().openId === null
  let queued = false
  const changed = () => {
    if (!pending || queued) return
    queued = true
    // Let synchronous location restoration finish before choosing a default.
    queueMicrotask(() => {
      queued = false
      if (!pending) return
      const state = read()
      if (state.openId || state.selectionRevision !== revision) { pending = false; return }
      if (!state.ready) return
      const first = filterReports(newestFirst(state.inbox.reports), state)[0]
      if (!first) return
      pending = false
      state.open(first.id)
    })
  }
  const stop = subscribe(changed)
  changed()
  return () => { pending = false; stop() }
}

export function watchReportsVisits(
  readScreen: () => string,
  subscribeScreen: (changed: () => void) => () => void,
  startVisit: () => () => void,
): () => void {
  let stopVisit: (() => void) | null = null
  let stopped = false
  const syncVisit = () => {
    if (stopped) return
    if (readScreen() === 'reports') {
      if (!stopVisit) stopVisit = startVisit()
      return
    }
    if (!stopVisit) return
    stopVisit()
    stopVisit = null
  }
  const stopWatchingScreen = subscribeScreen(syncVisit)
  syncVisit()
  return () => {
    if (stopped) return
    stopped = true
    stopWatchingScreen()
    stopVisit?.()
    stopVisit = null
  }
}
