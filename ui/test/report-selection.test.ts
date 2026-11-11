import assert from 'node:assert/strict'
import { test } from 'node:test'
import { visitReports } from '../src/features/reports/selection.ts'
import { createInbox } from '../src/features/reports/inbox.ts'

const old = { id: 'old', title: 'Recap', body: 'Old', outcome: 'completed', at: '2026-11-01', scheduleId: 'recap' }
const latest = { ...old, id: 'new', at: '2026-11-02' }

test('a visit waits for readiness and the first eligible filtered report, then selects once', async () => {
  let changed = () => {}
  const state = { ready: false, inbox: createInbox([latest]), kind: 'scheduled' as const, title: 'recap', openId: null as string | null, selectionRevision: 0, open: (id: string) => { state.openId = id } }
  const stop = visitReports(() => state, (listener) => { changed = listener; return () => { changed = () => {} } })
  await Promise.resolve()
  assert.equal(state.openId, null)
  state.ready = true
  state.title = 'missing'
  changed()
  await Promise.resolve()
  assert.equal(state.openId, null)
  state.title = 'RECAP'
  state.inbox = createInbox([old, latest])
  changed()
  await Promise.resolve()
  assert.equal(state.openId, 'new')
  state.openId = null
  changed()
  await Promise.resolve()
  assert.equal(state.openId, null, 'a consumed visit never reopens')
  stop()
})

test('explicit close, selection, and unmount win over queued defaults', async () => {
  for (const choice of ['close', 'restored', 'retained', 'unmount']) {
    const state = { ready: true, inbox: createInbox([latest]), kind: 'all' as const, title: '', openId: null as string | null, selectionRevision: 0, open: (id: string) => { state.openId = id } }
    if (choice === 'retained') state.openId = 'existing'
    const stop = visitReports(() => state, () => () => {})
    if (choice === 'retained') state.openId = null
    else if (choice === 'unmount') stop()
    else { state.selectionRevision++; state.openId = choice === 'restored' ? 'exact' : null }
    await Promise.resolve()
    assert.equal(state.openId, choice === 'restored' ? 'exact' : null)
    stop()
  }
})
