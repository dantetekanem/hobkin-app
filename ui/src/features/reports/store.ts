import { create } from 'zustand'
import { toast } from 'sonner'
import { withoutNothingNew } from '#shared/reports/nothing-new.ts'
import { hostStore, runCommand } from '../../lib/host/client.ts'
import type { HostState } from '../../lib/host/state.ts'
import { hasHost } from '../../lib/host/frame.ts'
import { countsAsRead, type Report } from './report.ts'
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
/** The real report in its undo time, which hobkin has not been told about. */
let pending: { id: string; home: string } | null = null
/** Reports hobkin was told to delete, until its snapshot stops listing them. */
const deleting = new Set<string>()
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
 * A delete of a real report waits out its undo time, then hobkin deletes it (`report.delete`, which cannot be
 * undone). Until hobkin's snapshot stops listing it, snapshots do not bring it back.
 */
export const useReports = create<ReportsState>()((set, get) => ({
  sample: true,
  ready: false,
  selectionRevision: 0,
  inbox: createInbox(withoutNothingNew(sampleReports), sampleRead),
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
    const { inbox, openId, sample } = get()
    if (!sample) {
      const { home, link } = hostStore.getState()
      if (home === null || link !== 'open') return toast.error('hobkin is not connected, so the report was not deleted.')
      if (!inbox.reports.some((report) => report.id === id)) return
      deleteInHobkin()
      pending = { id, home }
    }
    const next = removeReport(inbox, id, Date.now())
    if (next === inbox) return
    set({ inbox: next, openId: openId === id ? null : openId })
    // The undo line leaves on its own, whether or not the screen is still showing.
    clearTimeout(settling)
    settling = setTimeout(() => {
      set({ inbox: settle(get().inbox, Date.now()) })
      deleteInHobkin()
    }, next.removed!.until - Date.now())
  },
  undo: () => {
    pending = null
    clearTimeout(settling)
    set({ inbox: undoRemove(get().inbox) })
  },
}))

/** Tells hobkin to delete the report whose undo time has passed. If hobkin refuses, the report is listed again. */
function deleteInHobkin(): void {
  const settled = pending
  pending = null
  if (!settled || hostStore.getState().home !== settled.home) return
  deleting.add(settled.id)
  runCommand('report.delete', { id: settled.id }).catch((error: unknown) => {
    deleting.delete(settled.id)
    toast.error(error instanceof Error ? error.message : 'Could not delete the report.')
    if (hostStore.getState().home === settled.home) syncReports(hostStore.getState())
  })
}

function isReport(value: unknown): value is Report {
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
  // Whatever the host sends, a report that found nothing new is no report: not listed, not unread, not counted.
  const reports = Array.isArray(rows) ? withoutNothingNew(rows).filter(isReport) : []
  if (changedHome) {
    completedOpen = null
    pending = null
    deleting.clear()
  }
  if (completedOpen && current.openId === completedOpen.id) {
    const index = reports.findIndex(({ id }) => id === completedOpen!.id)
    if (index < 0) reports.unshift(completedOpen)
    else reports[index] = completedOpen
  }
  // What the user deleted stays off the list while hobkin's snapshot still lists it.
  if (ready) for (const id of deleting) if (!reports.some((report) => report.id === id)) deleting.delete(id)
  const hidden = sample ? [] : reports.filter((report) => deleting.has(report.id) || report.id === pending?.id)
  if (hidden.length) reports.splice(0, reports.length, ...reports.filter((report) => !hidden.includes(report)))
  const read = reports
    .filter((report) => countsAsRead(report) || (!changedHome && current.inbox.read.has(report.id)))
    .map(({ id }) => id)
  const inbox = sample ? createInbox(sampleReports, sampleRead) : createInbox(reports, read)
  if (pending) inbox.removed = current.inbox.removed
  else clearTimeout(settling)
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
