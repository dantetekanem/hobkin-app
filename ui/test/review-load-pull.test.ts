import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IDLE_STATUS, type ReviewStatus } from '../../shared/review/status.ts'
import { createReviewMemory } from '../src/features/review/state/memory.ts'
import { createReviewLoader, type ReviewCommands } from '../src/features/review/loader.ts'

function fixture(id: string, statuses: ReviewStatus[]) {
  const calls: string[] = []
  let at = 0
  const command = (async (name: string) => {
    calls.push(name)
    if (name === 'review.status') return statuses[Math.min(at++, statuses.length - 1)]
    if (name === 'review.prepare') return { ...IDLE_STATUS(id), state: 'preparing', phase: 'queued' }
    if (name === 'review.get') return { review: { id, nodes: [], edges: [], story: [], snapshot: 'a' }, status: statuses.at(-1), notes: { entries: [], draft: null } }
    throw new Error(name)
  }) as ReviewCommands
  let clock = 1000
  const loader = createReviewLoader({ id, scope: 's', command, memory: createReviewMemory(), now: () => clock })
  return { loader, calls, tick: (ms: number) => { clock += ms } }
}

test('opening a pull request starts nothing; Start AI review does', async () => {
  const { loader, calls } = fixture('pr:a/b/1', [IDLE_STATUS('pr:a/b/1')])
  await loader.load()
  assert.equal(loader.getState().status, 'awaiting')
  assert.deepEqual(calls, ['review.status'])
  await loader.start()
  assert.deepEqual(calls, ['review.status', 'review.prepare'])
  assert.equal(loader.getState().status, 'preparing')
  assert.equal(loader.getState().startedAt, 1000)
  loader.dispose()
})

test('a finished change still starts by itself', async () => {
  const id = 'change:p:i'
  const { loader, calls } = fixture(id, [IDLE_STATUS(id)])
  await loader.load()
  assert.deepEqual(calls, ['review.status', 'review.prepare'])
  assert.equal(loader.getState().status, 'preparing')
  loader.dispose()
})

test('polling keeps updating while preparing and stops asking when ready', async () => {
  const id = 'change:p:i'
  const running = (percent: number): ReviewStatus => ({ ...IDLE_STATUS(id), state: 'preparing', phase: 'reading', assessment: { state: 'running', head: 'h', percent, now: `step ${percent}` } })
  const { loader, calls, tick } = fixture(id, [running(10), running(50), { ...IDLE_STATUS(id), state: 'ready' }])
  await loader.load()
  assert.equal(loader.getState().preparation?.assessment?.percent, 10)
  const seen: string[] = []
  loader.subscribe((state) => seen.push(state.status))
  tick(5000)
  await loader.tick()
  assert.equal(loader.getState().preparation?.assessment?.percent, 50)
  assert.ok(!seen.includes('loading'), 'the waiting view keeps its state while polling')
  assert.equal(loader.getState().startedAt, 1000)
  await loader.tick()
  assert.equal(loader.getState().status, 'ready')
  assert.equal(loader.getState().startedAt, null)
  assert.ok(calls.includes('review.get'))
  loader.dispose()
})
