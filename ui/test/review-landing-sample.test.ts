import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Review, ReviewSource } from '../../shared/review/types.ts'
import { createReviewLoader } from '../src/features/review/loader.ts'
import { SAMPLE_CHANGE, SAMPLE_REFRESH_MS, sampleLanding, sampleLandings } from '../src/features/review/preparing/sample-landing.ts'
import { createReviewMemory } from '../src/features/review/state/memory.ts'
import { afterVerdict, createVerdictChoices } from '../src/features/review/verdict.ts'

const HEAD = '7d02c99f8c61be4291e0c2046d29787cbc1c010a'
const review = { id: SAMPLE_CHANGE, snapshot: 'a'.repeat(64), change: { head: HEAD }, nodes: [], edges: [], story: [] } as unknown as Review
const source: ReviewSource = {
  getReview: async () => review,
  getFile: async (_id, fileId) => ({ fileId, path: fileId, base: null, head: null, binary: false }),
}

test('the made-up landing host is the sample finished change’s alone, and never a live review’s', () => {
  assert.equal(typeof sampleLanding(SAMPLE_CHANGE, false, source), 'function')
  // A live review's commands are the connected host's own, whatever it is called.
  assert.equal(sampleLanding(SAMPLE_CHANGE, true, source), null)
  assert.equal(sampleLanding('change:hobkin:7d02c9', true, source), null)
  // Every other review keeps the source it has.
  assert.equal(sampleLanding('change:hobkin:7d02c9', false, source), null)
  assert.equal(sampleLanding('stress', false, source), null)
})

test('approve and merge on the sample finished change: an agent brings it up to date for a few seconds, it merges and closes with Merged!, and it opens merged after', async () => {
  let now = Date.parse('2026-11-12T21:00:00Z')
  const hostFor = sampleLandings(() => now)
  const command = hostFor(SAMPLE_CHANGE, source)
  const loader = createReviewLoader({ id: SAMPLE_CHANGE, scope: 'sample', command, memory: createReviewMemory() })
  await loader.load()
  assert.equal(loader.getState().preparation?.landing, undefined)

  const seen: string[] = []
  const choices = createVerdictChoices({
    id: SAMPLE_CHANGE,
    head: HEAD,
    command,
    saveNotes: async () => {},
    current: () => true,
    landed: (verdict, message) => afterVerdict(verdict, message, { here: () => true, close: () => void seen.push('close'), celebrate: (kind) => void seen.push(kind), landing: loader.look, follow: loader.follow }),
  })
  await choices.press('approve-merge')
  assert.ok(choices.getState().preview, 'the first click shows what it does')
  await choices.press('approve-merge')
  assert.equal(loader.getState().preparation?.landing?.state, 'refreshing')
  assert.equal(loader.getState().preparation?.head, HEAD, 'its branch moves, and the review holds still')
  assert.deepEqual(seen, [])

  now += SAMPLE_REFRESH_MS - 1
  await loader.tick()
  assert.deepEqual(seen, [])
  now += 1
  await loader.tick()
  assert.equal(loader.getState().preparation?.landing?.state, 'merged')
  assert.deepEqual(seen, ['tada', 'close'])
  loader.dispose()

  // Opened again while the window is open, it is merged already.
  const again = createReviewLoader({ id: SAMPLE_CHANGE, scope: 'sample', command: hostFor(SAMPLE_CHANGE, source), memory: createReviewMemory() })
  await again.load()
  assert.deepEqual([again.getState().status, again.getState().preparation?.landing?.state], ['ready', 'merged'])
  again.dispose()
})
