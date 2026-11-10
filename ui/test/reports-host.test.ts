import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { useReports } from '../src/features/reports/store.ts'
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
