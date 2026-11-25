import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import { hostStore } from '../src/lib/host/client.ts'
import { applyHostMessage, applyLink, initialHostState } from '../src/lib/host/state.ts'

// Import the stores as a Mac window, before the host has answered. No connection is started.
Object.defineProperty(globalThis, 'window', {
  value: { __TAURI_INTERNALS__: {}, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } },
  configurable: true,
})
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
const { useReports } = await import('../src/features/reports/store.ts')
const { useRoutines } = await import('../src/features/routines/store.ts')
const { useActionItems } = await import('../src/features/actions/store.ts')
after(() => {
  mock.timers.reset()
  Reflect.deleteProperty(globalThis, 'window')
})

for (const link of ['connecting', 'none'] as const) {
  test(`Mac ${link}: Reports waits for real reports`, () => {
    hostStore.setState({ ...initialHostState, link }, true)
    assert.equal(useReports.getState().sample, false)
    assert.deepEqual(useReports.getState().inbox.reports, [])
  })
  test(`Mac ${link}: Routines waits for real schedules`, () => {
    hostStore.setState({ ...initialHostState, link }, true)
    assert.equal(useRoutines.getState().sample, null)
    assert.deepEqual(useRoutines.getState().data.routines, [])
  })
  test(`Mac ${link}: Action Items waits for real decisions`, () => {
    hostStore.setState({ ...initialHostState, link }, true)
    assert.equal(useActionItems.getState().sample, false)
    assert.deepEqual(useActionItems.getState().rows, [])
  })
}

test('Mac reconnect keeps all three real lists until the replacement snapshot arrives', () => {
  const report = { id: 'real-report', title: 'Report', body: 'Real finding.', outcome: 'completed' }
  const routine = {
    id: 'real-routine', title: 'Routine', enabled: true, cadence: 'daily', at: '09:30',
    timezone: 'America/Toronto', harness: 'pi', model: null, effort: 'medium', cwd: '/project',
    context: [], path: '/test/routines/daily/check.md', prompt: 'Check.',
    nextRun: { state: 'scheduled', at: '2026-11-11T14:30:00Z' },
  }
  // A decision hobkin filed: a waiting report only opens in Reports, so it is not an action item (isActionItem).
  const decision = {
    id: 'real-decision', key: null, from: 'Routine', question: 'Keep the check?', tldr: 'Keep the check?',
    choices: [{ value: 'yes', label: 'Keep it' }, { value: 'no', label: 'Drop it' }],
    answerTo: null, recommended: null, why: null, changed: null, at: '2026-11-11T14:30:00Z',
  }
  hostStore.setState({ home: '/test', link: 'open' })
  hostStore.setState((state) => applyHostMessage(state, {
    type: 'state', rev: 1, reset: true,
    set: { reports: [report], schedules: [routine], decisions: [decision] },
  }))
  const reports = useReports.getState().inbox.reports
  const routines = useRoutines.getState().data.routines
  const actions = useActionItems.getState().rows
  assert.equal(reports[0]?.id, report.id)
  assert.equal(routines[0]?.id, routine.id)
  assert.equal(actions[0]?.id, decision.id)
  for (const link of ['lost', 'connecting', 'open'] as const) {
    hostStore.setState((state) => applyLink(state, link))
    // The same rows, not samples and not an empty list. Reports and Routines build their lists again on any change of
    // the link, so the rows are compared, not the arrays.
    assert.deepEqual(useReports.getState().inbox.reports, reports)
    assert.deepEqual(useRoutines.getState().data.routines, routines)
    assert.deepEqual(useActionItems.getState().rows, actions)
  }
  hostStore.setState((state) => applyHostMessage(state, { type: 'state', rev: 2, reset: true, set: {} }))
  assert.deepEqual(useReports.getState().inbox.reports, [])
  assert.deepEqual(useRoutines.getState().data.routines, [])
  assert.deepEqual(useActionItems.getState().rows, [])
})
