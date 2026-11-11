import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { useReports, watchFirstReport, watchReportRead } from '../src/features/reports/store.ts'
import { useView } from '../src/app/view-store.ts'
import { HostConnection } from '../src/lib/host/connection.ts'
import { hostStore } from '../src/lib/host/client.ts'
import { applyHostMessage, applyLink, initialHostState } from '../src/lib/host/state.ts'

const report = {
  id: 'local:recap:1',
  title: 'Morning recap',
  body: 'Useful: A real finding.\n\nFull details.',
  outcome: 'completed',
  scheduleId: 'morning-recap',
  at: '2026-11-10T08:00:00Z',
}
const hello = (home = '/hobkin') => hostStore.setState({ home, link: 'open' })
const snapshot = (reports: unknown, reset = true) => {
  hostStore.setState((state) => applyHostMessage(state, { type: 'state', rev: 1, ...(reset ? { reset: true } : {}), set: { reports } }))
}
const ids = () => useReports.getState().inbox.reports.map(({ id }) => id)

afterEach(() => {
  useReports.getState().undo()
  hostStore.setState(initialHostState, true)
  useReports.getState().setTitle('')
  useReports.getState().setKind('all')
  useReports.getState().close()
})

test('three seconds in a real report records its read; closing or changing homes cancels pending reads', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls: unknown[] = []
  t.mock.method(HostConnection.prototype, 'command', async (name: Parameters<HostConnection['command']>[0], args: Parameters<HostConnection['command']>[1]) => { calls.push([name, args]); return { ok: true } })
  hello()
  snapshot([report])
  useReports.getState().open(report.id)
  const stopReading = watchReportRead(report.id)
  t.after(stopReading)
  t.mock.timers.tick(2999)
  assert.deepEqual(calls, [])
  t.mock.timers.tick(1)
  await Promise.resolve()
  assert.deepEqual(calls, [['report.read', { id: report.id, dwellMs: 3000 }]])
  stopReading()
  const leaveReader = watchReportRead(report.id)
  t.mock.timers.tick(1000)
  leaveReader()
  t.mock.timers.tick(3000)
  assert.equal(calls.length, 1, 'unmounting the reader cancels its read even though selection is retained')
  const stopOldHome = watchReportRead(report.id)
  t.after(stopOldHome)
  hello('/different')
  t.mock.timers.tick(3000)
  assert.equal(calls.length, 1, 'never send an old-home read to the next host')
})

test('a disconnected reader waits for a fresh three seconds after reconnect', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls: unknown[] = []
  t.mock.method(HostConnection.prototype, 'command', async (name: Parameters<HostConnection['command']>[0], args: Parameters<HostConnection['command']>[1]) => { calls.push([name, args]); return { ok: true } })
  hello()
  snapshot([report])
  useReports.getState().open(report.id)
  const stop = watchReportRead(report.id)
  t.after(stop)
  t.mock.timers.tick(1000)
  hostStore.setState(state => applyLink(state, 'lost'))
  t.mock.timers.tick(3000)
  assert.deepEqual(calls, [])
  hello()
  t.mock.timers.tick(2999)
  assert.deepEqual(calls, [])
  t.mock.timers.tick(1)
  await Promise.resolve()
  assert.equal(calls.length, 1)
})

test('a new Reports visit defaults only after a fresh filtered list and never persists an immediate read', async t => {
  const calls: unknown[] = []
  t.mock.method(HostConnection.prototype, 'command', async () => { calls.push('command'); return { ok: true } })
  const stop = watchFirstReport()
  t.after(stop)
  await Promise.resolve()
  assert.equal(useReports.getState().openId, null, 'connecting samples are not authoritative')
  hello()
  await Promise.resolve()
  assert.equal(useReports.getState().openId, null)
  snapshot([])
  await Promise.resolve()
  assert.equal(useReports.getState().openId, null)
  useReports.getState().setTitle('morning')
  snapshot([{ ...report, id: 'other', title: 'Other', at: '2026-11-11' }, report])
  await Promise.resolve()
  assert.equal(useReports.getState().openId, report.id)
  assert.equal(useReports.getState().inbox.read.has(report.id), true)
  assert.deepEqual(calls, [])
  useReports.getState().close()
  snapshot([report])
  await Promise.resolve()
  assert.equal(useReports.getState().openId, null)
  stop()
  const nextVisit = watchFirstReport()
  t.after(nextVisit)
  await Promise.resolve()
  assert.equal(useReports.getState().openId, report.id)
  snapshot([])
  snapshot([{ ...report, id: 'replacement' }])
  await Promise.resolve()
  assert.equal(useReports.getState().openId, null, 'removal does not reopen another report during this visit')
})

test('leaving Reports rejects a late inventory and returning starts a new visit', async t => {
  const originalScreen = useView.getState().screen
  useView.getState().openScreen('home')
  const stopWatching = watchFirstReport({
    read: () => useView.getState().screen,
    subscribe: (changed) => useView.subscribe(changed),
  })
  t.after(() => {
    stopWatching()
    if (useView.getState().screen !== originalScreen) useView.getState().openScreen(originalScreen)
  })

  hello()
  snapshot([])
  useView.getState().openScreen('reports')
  await Promise.resolve()
  assert.equal(useReports.getState().openId, null)

  useView.getState().openScreen('home')
  snapshot([report])
  await Promise.resolve()
  assert.equal(useReports.getState().openId, null, 'a report arriving after departure is not opened')
  assert.equal(useReports.getState().inbox.read.has(report.id), false, 'the late report is not marked read')

  useView.getState().openScreen('reports')
  await Promise.resolve()
  assert.equal(useReports.getState().openId, report.id, 'returning starts a fresh visit against the current inventory')
})

test('restoration and an exact completed report outrank a queued visit default', async t => {
  hello()
  const stop = watchFirstReport()
  t.after(stop)
  snapshot([report, { ...report, id: 'newest', at: '2026-11-12' }])
  useReports.getState().open(report.id)
  await Promise.resolve()
  assert.equal(useReports.getState().openId, report.id)
  const completed = { ...report, id: 'completed', body: 'Exact completed body' }
  useReports.getState().open(completed.id, completed)
  useReports.getState().setTitle('excluded')
  snapshot([])
  await Promise.resolve()
  assert.equal(useReports.getState().openId, completed.id)
  assert.equal(useReports.getState().inbox.reports[0]?.body, completed.body)
})

test('a new-home visit rejects stale hello and link snapshots until publication; reconnect retains selection', async t => {
  hello()
  snapshot([report])
  useReports.getState().close()
  hello('/new-home')
  const stop = watchFirstReport()
  t.after(stop)
  hostStore.setState(state => applyLink(state, 'lost'))
  hello('/new-home')
  await Promise.resolve()
  assert.equal(useReports.getState().openId, null)
  assert.deepEqual(ids(), [])
  snapshot([{ ...report, id: 'new-home' }])
  await Promise.resolve()
  assert.equal(useReports.getState().openId, 'new-home')
  hostStore.setState(state => applyLink(state, 'lost'))
  hello('/new-home')
  snapshot([{ ...report, id: 'new-home' }, report])
  await Promise.resolve()
  assert.equal(useReports.getState().openId, 'new-home')
})

test('a host replaces samples with its exact report bodies and an empty snapshot stays empty', () => {
  assert.ok(ids().length > 0)
  hello()
  assert.deepEqual(ids(), [], 'samples disappear before the first snapshot')
  snapshot([report])
  assert.deepEqual(useReports.getState().inbox.reports, [report])
  snapshot([])
  assert.deepEqual(ids(), [])
})

test('updates keep filters, the open report and window read marks; removal closes the reader', () => {
  hello()
  snapshot([report])
  useReports.getState().setKind('scheduled')
  useReports.getState().setTitle('morning')
  useReports.getState().open(report.id)
  snapshot([{ ...report, body: 'Useful: Updated details.' }, { ...report, id: 'next' }], false)
  const state = useReports.getState()
  assert.equal(state.openId, report.id)
  assert.equal(state.inbox.reports[0]?.body, 'Useful: Updated details.')
  assert.equal(state.inbox.read.has(report.id), true)
  assert.equal(state.kind, 'scheduled')
  assert.equal(state.title, 'morning')
  snapshot([{ ...report, id: 'next' }])
  assert.equal(useReports.getState().openId, null)
  assert.deepEqual(ids(), ['next'])
})

test('a lost connection keeps the last real reports, and a reconnect replaces them', () => {
  hello()
  snapshot([report])
  hostStore.setState((state) => applyLink(state, 'lost'))
  assert.deepEqual(ids(), [report.id])
  hello()
  snapshot([{ ...report, id: 'reconnected' }])
  assert.deepEqual(ids(), ['reconnected'])
})

test('a different home clears the old reports and selections until its snapshot arrives', () => {
  hello()
  snapshot([report])
  useReports.getState().open(report.id)
  useReports.getState().setTitle('morning')
  hello('/another-home')
  assert.deepEqual(ids(), [])
  assert.equal(useReports.getState().openId, null)
  assert.equal(useReports.getState().title, '')
  snapshot([{ ...report, title: 'Another home' }])
  assert.equal(useReports.getState().inbox.read.has(report.id), false)
})

test('sample deletion cannot carry over to the host, and real reports cannot be deleted locally', () => {
  const sampleId = ids()[0]!
  useReports.getState().remove(sampleId)
  assert.ok(useReports.getState().inbox.removed)
  hello()
  snapshot([report])
  assert.equal(useReports.getState().inbox.removed, null)
  useReports.getState().undo()
  useReports.getState().remove(report.id)
  assert.deepEqual(ids(), [report.id])
  assert.equal(useReports.getState().inbox.removed, null)
})

test('only valid report rows reach the reader and imported read state is preserved', () => {
  hello()
  snapshot([null, {}, { ...report, id: 3 }, { ...report, body: null }, { ...report, at: 12 }, { ...report, readState: 'read' }])
  assert.deepEqual(ids(), [report.id])
  assert.equal(useReports.getState().inbox.read.has(report.id), true)
  snapshot(undefined)
  assert.deepEqual(ids(), [])
})
