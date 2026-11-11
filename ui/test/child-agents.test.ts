import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RunChild } from '#shared/protocol/snapshot.ts'
import { childLine, childrenSummary, helpersNow, satellitesOf } from '../src/features/work/child-summary.ts'

const child = (name: string, state: RunChild['state'], rest: Partial<RunChild> = {}): RunChild => ({ name, state, ...rest })

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

