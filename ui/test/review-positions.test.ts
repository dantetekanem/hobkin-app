import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Review } from '#shared/review/types.ts'
import { applyMemory, createReviewMemory, memoryKey, memoryStorage } from '../src/features/review/state/memory.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const positionOf = (review: Review, storage: ReturnType<typeof memoryStorage>, id: string) =>
  applyMemory(review, createReviewMemory(storage).getState().of(review)).nodes.find((node) => node.id === id)!.position

test("keeps a moved node's position for that review", () => {
  const storage = memoryStorage()
  const first = createReviewMemory(storage)
  const [moved, still] = [sample.nodes[3]!, sample.nodes[4]!]

  first.getState().moveNode(sample, moved.id, { x: 512.4, y: -40.6 })

  // Closing the review and opening it again is a new store over the same storage.
  assert.deepEqual(positionOf(sample, storage, moved.id), { x: 512, y: -41 }, 'the dropped place, on whole pixels')
  assert.deepEqual(positionOf(sample, storage, still.id), still.position, 'a node nobody moved keeps the place the review gave it')

  // The same change prepared again from another head is another review, with its own layout.
  const other = { ...sample, snapshot: 'f'.repeat(64) }
  assert.notEqual(memoryKey(other), memoryKey(sample))
  assert.deepEqual(positionOf(other, storage, moved.id), moved.position)

  // A second move replaces the first, and putting the layout back forgets every move.
  first.getState().moveNode(sample, moved.id, { x: 8, y: 8 })
  assert.deepEqual(positionOf(sample, storage, moved.id), { x: 8, y: 8 })
  first.getState().resetLayout(sample)
  assert.deepEqual(positionOf(sample, storage, moved.id), moved.position)
})

test('a saved position that makes no sense is ignored', () => {
  const storage = memoryStorage()
  const memory = createReviewMemory(storage)
  const node = sample.nodes[0]!

  memory.getState().moveNode(sample, node.id, { x: Number.NaN, y: 10 })
  memory.getState().moveNode(sample, 'not-a-node', { x: 1, y: 1 })
  assert.deepEqual(memory.getState().of(sample).positions, {}, 'nothing is saved for a place that is not a number or a node that is not there')

  // Storage written by something else, or left by an older version, never breaks a review.
  storage.setItem('hobkin-client-review', JSON.stringify({ state: { reviews: { [memoryKey(sample)]: { positions: { [node.id]: { x: 'left' } }, wires: 7 } } }, version: 1 }))
  assert.deepEqual(positionOf(sample, storage, node.id), node.position)
})
