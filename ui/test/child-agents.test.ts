import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RunChild } from '#shared/protocol/snapshot.ts'
import { childLine, childrenSummary, describeChild, helpersNow, satellitesOf } from '../src/features/work/child-summary.ts'
import { childrenFrom, mainChildrenFrom } from '../src/lib/host/frame.ts'
import { applyHostMessage, applyLink, initialHostState } from '../src/lib/host/state.ts'

const child = (name: string, state: RunChild['state'], rest: Partial<RunChild> = {}): RunChild => ({ name, state, ...rest })

test('owned and legacy states retain distinct meanings without invented ages', () => {
  const states = ['queued', 'running', 'cancelling', 'unknown', 'completed', 'failed', 'cancelled'] as const
  const owned = states.map((state, i) => child('same', state, {
    id: `c${i}`, parentId: 'root', rootId: 'root', depth: 1, activity: [],
  }))

  assert.deepEqual(owned.map(childLine), states)
  for (const row of owned) assert.ok(describeChild(row).includes(row.state))
  assert.deepEqual(helpersNow(owned), owned)
  assert.deepEqual(helpersNow([owned[2]!, owned[3]!]), [owned[2], owned[3]])
  assert.equal(childrenSummary(owned), '7 helpers · 1 running, 1 queued, 1 cancelling, 1 unknown, 1 failed, 1 completed, 1 cancelled')
  assert.deepEqual(satellitesOf(owned, 3).shown.map(({ id }) => id), ['c0', 'c1'])
  const legacyStates = ['queued', 'running', 'reported', 'failed', 'stopped'] as const
  assert.deepEqual(legacyStates.map((state) => childLine(child('legacy', state))), ['queued', 'running', 'reported', 'failed', 'never reported'])
  assert.deepEqual(mainChildrenFrom({ mainChildren: owned, connection: 'offline' }).map(({ state }) => state), ['unknown', 'unknown', 'unknown', 'unknown', 'completed', 'failed', 'cancelled'])
  assert.deepEqual(owned.map(({ startedAt, endedAt }) => [startedAt, endedAt]), states.map(() => [undefined, undefined]))
})

test('link loss, offline and pre-reset hello keep owned facts but not live claims; reset and unset replace them', () => {
  const rows = [
    child('same', 'running', { id: 'c', parentId: 'root', rootId: 'root', depth: 1 }),
    child('done', 'completed', { id: 'd', parentId: 'root', rootId: 'root', depth: 1 }),
    ...(
      ['queued', 'running', 'cancelling', 'reported', 'stopped', 'failed', 'cancelled', 'unknown'] as const
    ).map((state) => child(state, state)),
  ]
  const sourceStates = rows.map(({ state }) => state)
  const expectedStaleStates = [
    'unknown', 'completed', 'unknown', 'unknown', 'unknown',
    'reported', 'stopped', 'failed', 'cancelled', 'unknown',
  ]
  const hello = {
    type: 'hello', protocol: 1, home: '/fixture', model: 'scripted', models: null, viewState: null,
    owner: { state: 'live', limits: { images: 4, imageBytes: 1024 } }, signIn: { status: 'signed-in' },
  } as const
  const reset = {
    type: 'state', rev: 1, reset: true,
    set: { connection: 'connected', jobChildren: { root: rows }, mainChildren: rows },
  } as const
  const current = applyHostMessage(applyHostMessage(initialHostState, hello), reset)
  assert.deepEqual([childrenFrom(current.snapshot, 'root', current), mainChildrenFrom(current.snapshot, current)], [rows, rows])
  const staleStates = [
    applyLink(current, 'lost'),
    applyHostMessage(current, hello),
    { ...current, snapshot: { ...current.snapshot, connection: 'offline' as const } },
  ]
  for (const stale of staleStates) {
    assert.deepEqual(childrenFrom(stale.snapshot, 'root', stale).map(({ state }) => state), expectedStaleStates)
    assert.deepEqual(mainChildrenFrom(stale.snapshot, stale).map(({ state }) => state), expectedStaleStates)
    assert.deepEqual(stale.snapshot.mainChildren?.map(({ state }) => state), sourceStates, 'last-known source facts stay intact')
    assert.equal(mainChildrenFrom(stale.snapshot, stale), mainChildrenFrom(stale.snapshot, stale), 'stable selector reference')
  }

  const restored = applyHostMessage(applyHostMessage(current, hello), reset)
  assert.deepEqual(mainChildrenFrom(restored.snapshot, restored), rows)
  assert.deepEqual(mainChildrenFrom(applyHostMessage(restored, { type: 'state', rev: 2, unset: ['mainChildren'] }).snapshot, restored), [])
  assert.deepEqual(childrenFrom({}, 'root'), [])
  const awaitingReset = applyHostMessage(applyHostMessage(current, hello), { type: 'state', rev: 2, set: { busy: false } })
  assert.deepEqual(childrenFrom(awaitingReset.snapshot, 'root', awaitingReset).map(({ state }) => state), expectedStaleStates)
  assert.deepEqual(mainChildrenFrom(awaitingReset.snapshot, awaitingReset).map(({ state }) => state), expectedStaleStates)
  assert.deepEqual(mainChildrenFrom(applyHostMessage(current, { type: 'state', rev: 2, reset: true }).snapshot), [])
})

test('a run is summed up by how many it spawned and how each stands, what is still out first', () => {
  assert.equal(childrenSummary([]), '', 'a run that spawned none says nothing')
  assert.equal(childrenSummary([child('scout', 'reported'), child('fix', 'running'), child('review', 'queued')]), '3 helpers · 1 running, 1 queued, 1 reported')
  assert.equal(childrenSummary([child('scan', 'stopped'), child('lock', 'failed'), child('read', 'running'), child('more', 'running')]), '4 helpers · 2 running, 1 failed, 1 never reported')
  assert.equal(childrenSummary([child('only', 'queued')]), '1 helper · 1 queued')
})

test("a running child's line carries its last phase or tool only when the run asked for it", () => {
  assert.equal(childLine(child('fix', 'running')), 'running')
  assert.equal(childLine(child('fix', 'running', { phase: 'working', activeTool: 'bash' })), 'running · bash')
  assert.equal(childLine(child('read', 'running', { phase: 'thinking' })), 'running · thinking')
  assert.equal(childLine(child('review', 'queued', { queuePosition: 2 })), 'queued · #2')
  assert.equal(childLine(child('scan', 'stopped')), 'never reported', 'an ended run says what is known, not that it was stopped')
})

test('a node shows every child that fits, and past that the ones still out first, in the order they came', () => {
  const few = [child('a', 'reported'), child('b', 'running')]
  assert.deepEqual(satellitesOf(few, 3), { shown: few, more: 0 })

  const many = [child('a', 'reported'), child('b', 'failed'), child('c', 'running'), child('d', 'reported'), child('e', 'queued')]
  const { shown, more } = satellitesOf(many, 3)
  assert.deepEqual(
    shown.map(({ name }) => name),
    ['c', 'e'],
    'one place goes to the count of the rest',
  )
  assert.equal(more, 3)
})

test("hobkin's own helpers show while any is out, with the ones that ended meanwhile, never a long chat's earlier ones", () => {
  const earlier = child('earlier', 'reported', { startedAt: 1, endedAt: 5 })
  assert.deepEqual(helpersNow([earlier]), [], 'all ended: nothing runs now')
  const scout = child('scout', 'reported', { startedAt: 10, endedAt: 20 })
  const fix = child('fix', 'running', { startedAt: 10 })
  const review = child('review', 'queued', { startedAt: 12 })
  assert.deepEqual(helpersNow([earlier, scout, fix, review]), [scout, fix, review])
  assert.deepEqual(helpersNow([earlier, child('lock', 'failed', { endedAt: 11 }), fix]), [child('lock', 'failed', { endedAt: 11 }), fix])
})

