import { create } from 'zustand'
import { hostStore } from '../../lib/host/client.ts'
import type { HostState } from '../../lib/host/state.ts'
import type { Report } from './report.ts'
import { createInbox, openReport, removeReport, settle, undoRemove, type Inbox, type KindFilter } from './inbox.ts'
import { sampleRead, sampleReports } from './sample.ts'

interface ReportsState {
  sample: boolean
  inbox: Inbox
  kind: KindFilter
  /** The title filter's text. */
  title: string
  /** The report open in the reader, if any. */
  openId: string | null

  setKind: (kind: KindFilter) => void
  setTitle: (title: string) => void
  /** Opens a report in the reader. Opening it is reading it. */
  open: (id: string) => void
  close: () => void
  /** Takes a report off the list. It can be brought back until its undo line leaves. */
  remove: (id: string) => void
  undo: () => void
}

let settling: ReturnType<typeof setTimeout> | undefined

/**
 * The Reports screen's state. It outlives the screen, so leaving Reports and coming back finds the same
 * filters and the same open report. The host supplies reports; read marks stay in this window.
 * Deletion is sample-only until the host supports it.
 */
export const useReports = create<ReportsState>()((set, get) => ({
  sample: true,
  inbox: createInbox(sampleReports, sampleRead),
  kind: 'all',
  title: '',
  openId: null,

  setKind: (kind) => set({ kind }),
  setTitle: (title) => set({ title }),
  open: (id) => {
    const { inbox } = get()
    if (inbox.reports.some((report) => report.id === id)) set({ openId: id, inbox: openReport(inbox, id) })
  },
  close: () => set({ openId: null }),
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
  if (previous && state.home === previous.home && state.snapshot.reports === previous.snapshot.reports && state.epoch === previous.epoch) {
    return
  }
  const changedHome = previous !== undefined && state.home !== previous.home
  const sample = state.home === null
  const current = useReports.getState()
  // A new host's hello still carries the previous snapshot. Wait for its state message.
  const rows = changedHome ? [] : state.snapshot.reports
  const reports = Array.isArray(rows) ? rows.filter(isReport) : []
  const read = reports
    .filter((report) => report.readState === 'read' || (!changedHome && current.inbox.read.has(report.id)))
    .map(({ id }) => id)
  const inbox = sample ? createInbox(sampleReports, sampleRead) : createInbox(reports, read)
  clearTimeout(settling)
  useReports.setState({
    sample,
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
