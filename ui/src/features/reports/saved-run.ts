import type { SavedJobSession } from '#shared/commands/registry.ts'
import { useView } from '../../app/view-store.ts'
import { hostStore } from '../../lib/host/client.ts'
import type { HostState } from '../../lib/host/state.ts'
import { useReports } from './store.ts'
export type SavedRunState = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; session: SavedJobSession }
interface ReadingScope {
  current: () => boolean
  subscribe: (changed: () => void) => () => void
}
export function savedRunScope(report: string, origin: Pick<HostState, 'home' | 'epoch'>): ReadingScope {
  return {
    current: () => {
      const host = hostStore.getState()
      return host.home === origin.home && host.epoch === origin.epoch && host.link === 'open' && useView.getState().screen === 'reports' && useReports.getState().openId === report
    },
    subscribe: changed => {
      const stops = [hostStore.subscribe(changed), useView.subscribe(changed), useReports.subscribe(changed)]
      return () => stops.forEach(stop => stop())
    },
  }
}
/** A view owns one load. Leaving its report/home/connection invalidates it, even if the user returns before it settles. */
export function loadSavedRun(report: string, read: (report: string) => Promise<SavedJobSession>, show: (state: SavedRunState) => void, scope?: ReadingScope): () => void {
  let active = true
  const changed = () => {
    if (active && scope && !scope.current()) {
      active = false
      show({ phase: 'error', message: 'The report, connection or home changed. Return to the report and open its saved run again.' })
    }
  }
  const unsubscribe = scope?.subscribe(changed)
  show({ phase: 'loading' })
  changed()
  if (active) void read(report).then(
    session => {
      changed()
      if (active) show(session.report === report ? { phase: 'ready', session } : { phase: 'error', message: 'The saved run did not belong to this report.' })
    },
    error => {
      changed()
      if (active) show({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    },
  )
  return () => { active = false; unsubscribe?.() }
}
