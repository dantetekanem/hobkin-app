import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SavedJobSession } from '../../shared/commands/registry.ts'
import { loadSavedRun, savedRunScope, type SavedRunState } from '../src/features/reports/saved-run.ts'
import { useView } from '../src/app/view-store.ts'
import { hostStore } from '../src/lib/host/client.ts'
import { useReports } from '../src/features/reports/store.ts'
const session = (report: string): SavedJobSession => ({ report, run: `run:${report}`, entries: [], cut: false, skipped: 0, limit: 2097152 })
const flush = () => new Promise<void>(resolve => queueMicrotask(resolve))
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('loads the exact report identity and exposes loading, ready and errors', async () => {
  const states: SavedRunState[] = []
  const read = deferred<SavedJobSession>()
  loadSavedRun('report', id => { assert.equal(id, 'report'); return read.promise }, state => states.push(state))
  assert.deepEqual(states, [{ phase: 'loading' }])
  read.resolve(session('report')); await flush()
  assert.deepEqual(states.at(-1), { phase: 'ready', session: session('report') })
  loadSavedRun('report', async () => { throw Error('Saved session missing') }, state => states.push(state))
  await flush()
  assert.deepEqual(states.at(-1), { phase: 'error', message: 'Saved session missing' })
})

test('a superseding report ignores the earlier selection response', async () => {
  const states: SavedRunState[] = []
  const first = deferred<SavedJobSession>()
  const cancel = loadSavedRun('old', () => first.promise, state => states.push(state))
  cancel()
  loadSavedRun('new', async () => session('new'), state => states.push(state))
  await flush()
  first.resolve(session('old')); await flush()
  assert.deepEqual(states.at(-1), { phase: 'ready', session: session('new') })
  assert.equal(states.some(state => state.phase === 'ready' && state.session.report === 'old'), false)
})

test('leaving and returning cannot revive a pending load; origin changes also invalidate it', async () => {
  const before = { host: hostStore.getState(), view: useView.getState(), reports: useReports.getState() }
  try {
    const reset = () => {
      hostStore.setState({ home: '/synthetic-home', epoch: 0, link: 'open' })
      useView.setState({ screen: 'reports' }); useReports.setState({ openId: 'report' })
    }
    const changes = [
      () => useReports.setState({ openId: 'another-report' }),
      () => useView.setState({ screen: 'work' }),
      () => hostStore.setState({ home: '/other-synthetic-home' }),
      () => hostStore.setState({ epoch: 1 }),
      () => hostStore.setState({ link: 'lost' }),
    ]
    for (const change of changes) {
      reset()
      const pending = deferred<SavedJobSession>()
      const states: SavedRunState[] = []
      const cancel = loadSavedRun('report', () => pending.promise, state => states.push(state), savedRunScope('report', hostStore.getState()))
      change(); reset()
      pending.resolve(session('report')); await flush()
      assert.equal(states.some(state => state.phase === 'ready'), false)
      assert.equal(states.at(-1)?.phase, 'error')
      cancel()
    }
  } finally {
    hostStore.setState(before.host, true); useView.setState(before.view, true); useReports.setState(before.reports, true)
  }
})

test('rejects a mismatched response identity', async () => {
  const states: SavedRunState[] = []
  loadSavedRun('report', async () => session('other'), state => states.push(state))
  await flush()
  assert.equal(states.at(-1)?.phase, 'error')
})

test('late failures cannot replace a closed view or reopen it', async () => {
  const states: SavedRunState[] = []
  const pending = deferred<SavedJobSession>()
  const close = loadSavedRun('report', () => pending.promise, state => states.push(state))
  close(); pending.reject(Error('Too late')); await flush()
  assert.deepEqual(states, [{ phase: 'loading' }])
})
test('an entry is written at its own time, else its message\'s, else at none', async () => {
  const { entryTime } = await import('../src/features/reports/saved-run.ts')
  assert.equal(entryTime({ timestamp: '2026-11-19T15:30:01.000Z', message: { timestamp: 5 } }), '2026-11-19T15:30:01.000Z')
  assert.equal(entryTime({ message: { timestamp: 1_800_000_000_000 } }), 1_800_000_000_000)
  assert.equal(entryTime({ type: 'session' }), null)
  assert.equal(entryTime({ timestamp: '' }), null)
})
