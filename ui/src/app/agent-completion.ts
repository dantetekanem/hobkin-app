import type { StoreApi } from 'zustand/vanilla'
import type { HostState } from '../lib/host/state.ts'
import { useReports } from '../features/reports/store.ts'
import { useView } from './view-store.ts'

/** How long a finished agent's report may take to arrive before the window goes back Home without it. */
export const REPORT_GRACE_MS = 4000

/** Runs `run` after `ms`, and answers how to call it off. */
type Later = (run: () => void, ms: number) => () => void

const afterDelay: Later = (run, ms) => {
  const timer = setTimeout(run, ms)
  return () => clearTimeout(timer)
}

/**
 * Only a running agent watched continuously may hand its canvas on when it ends: to its report, or back Home when it
 * left none. A report can arrive a moment after the run ends, so an unknown one is waited for briefly. No focus requests.
 */
export function startAgentCompletion({ host, notice, later = afterDelay }: { host: StoreApi<HostState>; notice: (line: string) => void; later?: Later }): () => void {
  const viewed = () => {
    const view = useView.getState()
    return view.screen === 'agent' && !view.veil && !view.spotlight ? view.openAgent : null
  }
  let id = viewed()
  let armed = false
  let stopped = false
  let cancelWait: (() => void) | null = null
  let { home, epoch } = host.getState()

  const stopWaiting = () => {
    cancelWait?.()
    cancelWait = null
  }
  const goHome = () => {
    armed = false
    stopWaiting()
    useView.getState().openScreen('home')
    notice('This agent finished with no report.')
  }

  const observe = (state: HostState) => {
    if (stopped) return
    // Report-store listeners can run before our host listener on the same reset.
    if (state.home !== home || state.epoch !== epoch) {
      home = state.home
      epoch = state.epoch
      armed = false
      stopWaiting()
      return
    }
    if (state.link !== 'open' || !state.home || !id) return
    const run = state.snapshot.runs?.find((run) => run.id === id && run.kind !== 'main')
    if (run?.state === 'running') {
      armed = true
      stopWaiting()
      return
    }
    if (!armed) return

    const report = state.snapshot.completedJobReports?.[id]
    // Missing linkage is unknown, including on older hosts. The inventory may arrive before the mapping.
    const available = report === null ? undefined : report ?? useReports.getState().inbox.reports.find((row) => row.id === id)
    if (available) {
      armed = false
      stopWaiting()
      useReports.getState().open(available.id, available)
      useView.getState().openScreen('reports')
      return
    }
    if (report === null) return goHome()
    // Unknown: the report may still be on its way. It gets a moment, and without it the window goes back Home.
    const waitingFor = id
    cancelWait ??= later(() => {
      cancelWait = null
      if (!stopped && armed && viewed() === waitingFor) goHome()
    }, REPORT_GRACE_MS)
  }
  const offView = useView.subscribe(() => {
    const next = viewed()
    if (next === id) return
    id = next
    armed = false
    stopWaiting()
    observe(host.getState())
  })
  const offHost = host.subscribe(observe)
  // Linkage can arrive in the report inventory separately from the run snapshot.
  const offReports = useReports.subscribe(() => observe(host.getState()))
  observe(host.getState())
  return () => { stopped = true; stopWaiting(); offView(); offHost(); offReports() }
}
