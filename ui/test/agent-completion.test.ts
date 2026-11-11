import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from 'zustand/vanilla'
import { startAgentCompletion } from '../src/app/agent-completion.ts'
import { useView } from '../src/app/view-store.ts'
import { useReports } from '../src/features/reports/store.ts'
import { createInbox } from '../src/features/reports/inbox.ts'
import { initialHostState, type HostState } from '../src/lib/host/state.ts'
import { hostStore } from '../src/lib/host/client.ts'

const report = { id: 'actual-report', title: 'Result', body: 'Actual result', outcome: 'completed' }

/** The wait for a report that may still be on its way, run by the test instead of the clock. */
function manualTimers() {
  const pending = new Set<() => void>()
  const later = (run: () => void) => {
    pending.add(run)
    return () => pending.delete(run)
  }
  const fire = () => {
    for (const run of [...pending]) {
      pending.delete(run)
      run()
    }
  }
  return { later, fire, pending }
}

function fixture() {
  useView.setState({ screen: 'agent', openAgent: 'run', previewReturn: null, agentTalk: true, veil: null, spotlight: false })
  useReports.setState({ inbox: createInbox([]), openId: null })
  const host = createStore<HostState>(() => ({ ...initialHostState, link: 'open', home: '/fixture', snapshot: {} }))
  const notices: string[] = []
  const timers = manualTimers()
  const stop = startAgentCompletion({ host, notice: (line) => notices.push(line), later: timers.later })
  const running = () => host.setState({ snapshot: { runs: [{ id: 'run', title: 'Agent', state: 'running' }] } })
  const finish = (mapping?: Record<string, typeof report | null>, state = 'completed') => host.setState({ snapshot: {
    runs: [{ id: 'run', title: 'Agent', state }], ...(mapping && { completedJobReports: mapping }),
  } })
  return { host, notices, stop, running, finish, fire: timers.fire, waiting: () => timers.pending.size }
}

for (const state of ['completed', 'failed']) test(`opens the exact report on ${state}, even outside the inventory`, () => {
  const f = fixture()
  try {
    f.running()
    useReports.setState({ inbox: createInbox([{ ...report, body: 'Stale inventory preview' }]) })
    f.finish({ run: report }, state)
    assert.equal(useView.getState().screen, 'reports')
    assert.equal(useReports.getState().openId, report.id)
    assert.equal(useReports.getState().inbox.reports[0]?.body, report.body)
    assert.equal(useReports.getState().inbox.read.has(report.id), true)
    assert.deepEqual(f.notices, [])
  } finally { f.stop() }
})

test('authoritative no-report goes back Home and posts just one notice across reset/reconnect', () => {
  const f = fixture()
  try {
    f.running()
    useReports.setState({ inbox: createInbox([{ ...report, id: 'run' }]), openId: 'run' })
    f.finish({ run: null })
    assert.equal(useView.getState().screen, 'home')
    assert.equal(f.notices.length, 1)
    assert.match(f.notices[0]!, /no report/i)
    useView.getState().openAgentCanvas('run')
    f.host.setState({ epoch: 1, link: 'lost' }); f.host.setState({ link: 'open' })
    f.finish({ run: null })
    assert.equal(f.notices.length, 1)
    assert.equal(useView.getState().screen, 'agent')
  } finally { f.stop() }
})

test('waits a moment for a report that is still on its way, and opens it when it comes', () => {
  const f = fixture()
  try {
    f.running(); f.finish()
    assert.equal(useView.getState().screen, 'agent')
    assert.deepEqual(f.notices, [])
    f.finish({ run: report })
    assert.equal(useReports.getState().openId, report.id)
    assert.equal(f.waiting(), 0, 'the wait ends with the report')
  } finally { f.stop() }
})

test('an agent that ends and leaves no report within that moment goes back Home', () => {
  const f = fixture()
  try {
    f.running(); f.finish()
    assert.equal(useView.getState().screen, 'agent')

    f.fire()

    assert.equal(useView.getState().screen, 'home')
    assert.equal(useReports.getState().openId, null)
    assert.equal(f.notices.length, 1)
    assert.match(f.notices[0]!, /no report/i)
  } finally { f.stop() }
})

for (const leave of [() => useView.getState().openScreen('work'), () => useView.getState().openAgentCanvas('other'),
  () => { useView.getState().openScreen('work'); useView.getState().openAgentCanvas('run') }]) {
  test('leaving or switching cancels delayed navigation, even if returning', () => {
    const f = fixture()
    try {
      f.running(); f.finish(); leave(); f.finish({ run: report }); f.fire()
      assert.notEqual(useView.getState().screen, 'reports')
      assert.notEqual(useView.getState().screen, 'home')
      assert.equal(useReports.getState().openId, null)
    } finally { f.stop() }
  })
}

test('separately arriving report inventory opens the matching run only', () => {
  const f = fixture()
  try {
    f.running(); f.finish()
    useReports.setState({ inbox: createInbox([{ ...report, id: 'unrelated' }]) })
    assert.equal(useView.getState().screen, 'agent')
    useReports.setState({ inbox: createInbox([{ ...report, id: 'run' }]) })
    assert.equal(useReports.getState().openId, 'run')
  } finally { f.stop() }
})

test('a handed-off report stays readable on later inventory updates, but not across homes', () => {
  const before = hostStore.getState()
  try {
    hostStore.setState({ home: '/fixture', snapshot: { reports: [] } })
    useReports.getState().open(report.id, report)
    hostStore.setState({ snapshot: { reports: [] } })
    assert.equal(useReports.getState().openId, report.id)
    hostStore.setState({ home: '/other-fixture' })
    assert.equal(useReports.getState().openId, null)
  } finally { hostStore.setState(before, true) }
})

test('an atomic reconnect carrying terminal state and reports cannot race the reports subscription', () => {
  const before = hostStore.getState()
  useView.setState({ screen: 'agent', openAgent: 'run', veil: null, spotlight: false })
  hostStore.setState({ ...initialHostState, home: '/fixture', link: 'open', snapshot: { runs: [{ id: 'run', title: 'Agent', state: 'running' }] } }, true)
  const stop = startAgentCompletion({ host: hostStore, notice: () => assert.fail('unsolicited notice') })
  try {
    hostStore.setState({ epoch: 1, snapshot: {
      runs: [{ id: 'run', title: 'Agent', state: 'completed' }], reports: [{ ...report, id: 'run' }],
      completedJobReports: { run: report },
    } })
    assert.equal(useView.getState().screen, 'agent')
  } finally { stop(); hostStore.setState(before, true) }
})

test('startup terminal state, reset and disposed listeners never cause unsolicited navigation', () => {
  const f = fixture()
  f.finish({ run: report })
  assert.equal(useView.getState().screen, 'agent')
  f.running(); f.host.setState({ epoch: 1 }); f.finish({ run: report })
  assert.equal(useView.getState().screen, 'agent')
  f.running(); f.stop(); f.finish({ run: report })
  assert.equal(useView.getState().screen, 'agent')
})
