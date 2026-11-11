import { create } from 'zustand'
import { toast } from 'sonner'
import { hostStore, runCommand } from '../../lib/host/client.ts'
import type { HostState } from '../../lib/host/state.ts'
import { hasHost } from '../../lib/host/frame.ts'
import type { Report } from './report.ts'
import { createInbox, openReport, removeReport, settle, undoRemove, type Inbox, type KindFilter } from './inbox.ts'
import { sampleRead, sampleReports } from './sample.ts'
import { visitReports, watchReportsVisits } from './selection.ts'

type ReportsScreenVisit = {
  read: () => string
  subscribe: (changed: () => void) => () => void
}

export const watchFirstReport = (screen?: ReportsScreenVisit) => {
  const startVisit = () => visitReports(useReports.getState, useReports.subscribe)
  if (!screen) return startVisit()
  return watchReportsVisits(screen.read, screen.subscribe, startVisit)
}

interface ReportsState {
  sample: boolean
  ready: boolean
  selectionRevision: number
  inbox: Inbox
  kind: KindFilter
  /** The title filter's text. */
  title: string
  /** The report open in the reader, if any. */
  openId: string | null

  setKind: (kind: KindFilter) => void
  setTitle: (title: string) => void
  /** Opens a report locally. The mounted reader records sustained reading separately. */
  open: (id: string, completed?: Report) => void
  close: () => void
  /** Takes a report off the list. It can be brought back until its undo line leaves. */
  remove: (id: string) => void
  undo: () => void
}

let settling: ReturnType<typeof setTimeout> | undefined
const READ_MS = 3000

/** The mounted reader owns this lifetime, not its retained selection after leaving Reports. */
export function watchReportRead(id: string): () => void {
  const { home } = hostStore.getState()
  if (useReports.getState().sample || home === null) return () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  let recorded = false
  const start = () => {
    clearTimeout(timer)
    const host = hostStore.getState()
    if (recorded || host.home !== home || host.link !== 'open') return
    timer = setTimeout(() => {
      if (hostStore.getState().home !== home || useReports.getState().openId !== id) return
      recorded = true
      void runCommand('report.read', { id, dwellMs: READ_MS }).catch((error: unknown) => {
        recorded = false
        if (hostStore.getState().home === home) {
          toast.error(error instanceof Error ? error.message : 'Could not save the report read.')
        }
      })
    }, READ_MS)
  }
  const unsubscribe = hostStore.subscribe((state, previous) => {
    if (state.home !== previous.home || state.link !== previous.link) start()
  })
  start()
  return () => {
    clearTimeout(timer)
    unsubscribe()
  }
}

// Keep the exact completion report readable until the reader closes or the home changes.
let completedOpen: Report | null = null

/**
 * The Reports screen's state. It outlives the screen, so leaving Reports and coming back finds the same
 * filters and the same open report. The host persists read marks after three seconds; actions stay open.
 * Deletion is sample-only until the host supports it.
 */
export const useReports = create<ReportsState>()((set, get) => ({
  sample: true,
  ready: false,
  selectionRevision: 0,
  inbox: createInbox(sampleReports, sampleRead),
  kind: 'all',
  title: '',
  openId: null,

  setKind: (kind) => set({ kind }),
  setTitle: (title) => set({ title }),
  open: (id, completed) => {
    completedOpen = completed ?? null
    let { inbox } = get()
    if (completed?.id === id) {
      inbox = { ...inbox, reports: [completed, ...inbox.reports.filter((report) => report.id !== id)] }
    }
    if (inbox.reports.some((report) => report.id === id)) set({ openId: id, inbox: openReport(inbox, id), selectionRevision: get().selectionRevision + 1 })
  },
  close: () => { completedOpen = null; set({ openId: null, selectionRevision: get().selectionRevision + 1 }) },
  remove: (id) => {
    if (!get().sample) return
    const { inbox, openId } = get()
    const next = removeReport(inbox, id, Date.now())
    if (next === inbox) return
    set({ inbox: next, openId: openId === id ? null : openId })
    // The undo line leaves on its own, whether or not the screen is still showing.
    clearTimeout(settling)
    settling = setTimeout(() => set({ inbox: settle(get().inbox, Date.now()) }), next.removed!.until - Date.now())
  },
  undo: () => {
    if (!get().sample) return
    clearTimeout(settling)
    set({ inbox: undoRemove(get().inbox) })
  },
}))

function isReport(value: unknown): value is Report & { readState?: unknown } {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' && row.id.length > 0 &&
    typeof row.title === 'string' &&
    typeof row.body === 'string' &&
    typeof row.outcome === 'string' &&
    (row.at === undefined || typeof row.at === 'string') &&
    (row.scheduleId === undefined || typeof row.scheduleId === 'string')
  )
}

function syncReports(state: HostState, previous?: HostState): void {
  if (previous && state.home === previous.home && state.snapshot.reports === previous.snapshot.reports && state.epoch === previous.epoch && state.link === previous.link) {
    return
  }
  const changedHome = previous !== undefined && state.home !== previous.home
  const sample = !hasHost(state)
  const current = useReports.getState()
  // A new host's hello still carries the previous snapshot. Link changes cannot publish it.
  const published = !changedHome && (!previous || state.snapshot.reports !== previous.snapshot.reports || state.epoch !== previous.epoch)
  const ready = sample ? state.link === 'none' : !changedHome && (current.ready || published)
  const rows = ready ? state.snapshot.reports : []
  const reports = Array.isArray(rows) ? rows.filter(isReport) : []
  if (changedHome) completedOpen = null
  if (completedOpen && current.openId === completedOpen.id) {
    const index = reports.findIndex(({ id }) => id === completedOpen!.id)
    if (index < 0) reports.unshift(completedOpen)
    else reports[index] = completedOpen
  }
  const read = reports
    .filter((report) => report.readState === 'read' || (!changedHome && current.inbox.read.has(report.id)))
    .map(({ id }) => id)
  const inbox = sample ? createInbox(sampleReports, sampleRead) : createInbox(reports, read)
  clearTimeout(settling)
  useReports.setState({
    sample,
    ready,
    inbox,
    openId: !changedHome && inbox.reports.some(({ id }) => id === current.openId) ? current.openId : null,
    ...(changedHome ? { kind: 'all', title: '' } : {}),
  })
}

syncReports(hostStore.getState())
const unsubscribe = hostStore.subscribe(syncReports)
import.meta.hot?.dispose(() => {
  unsubscribe()
  clearTimeout(settling)
})
