import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Review } from '#shared/review/types.ts'
import { applyMemory, createReviewMemory, LAYOUT_VERSION, memoryKey, memoryStorage } from '../src/features/review/state/memory.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const positionOf = (review: Review, storage: ReturnType<typeof memoryStorage>, id: string) =>
  applyMemory(review, createReviewMemory(storage).getState().of(review)).nodes.find((node) => node.id === id)!.position
/** Where the canvas lays a node out when nobody moved it: in the order a request goes (graph/arrange.ts). */
const laidOut = (review: Review, id: string) => positionOf(review, memoryStorage(), id)

test("keeps a moved node's position for that review", () => {
  const storage = memoryStorage()
  const first = createReviewMemory(storage)
  const [moved, still] = [sample.nodes[3]!, sample.nodes[4]!]

  first.getState().moveNode(sample, moved.id, { x: 512.4, y: -40.6 })

  // Closing the review and opening it again is a new store over the same storage.
  assert.deepEqual(positionOf(sample, storage, moved.id), { x: 512, y: -41 }, 'the dropped place, on whole pixels')
  assert.deepEqual(positionOf(sample, storage, still.id), laidOut(sample, still.id), 'a node nobody moved keeps the place the canvas gave it')

  // The same change prepared again from another head is another review, with its own layout.
  const other = { ...sample, snapshot: 'f'.repeat(64) }
  assert.notEqual(memoryKey(other), memoryKey(sample))
  assert.deepEqual(positionOf(other, storage, moved.id), laidOut(other, moved.id))

  // A second move replaces the first, and putting the layout back forgets every move.
  first.getState().moveNode(sample, moved.id, { x: 8, y: 8 })
  assert.deepEqual(positionOf(sample, storage, moved.id), { x: 8, y: 8 })
  first.getState().resetLayout(sample)
  assert.deepEqual(positionOf(sample, storage, moved.id), laidOut(sample, moved.id))
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
  assert.deepEqual(positionOf(sample, storage, node.id), laidOut(sample, node.id))
})

test('positions saved for the layout before zones are dropped once, and a node moved since stays where it was put', () => {
  const storage = memoryStorage()
  const node = sample.nodes[3]!
  // An older window saved this place, with no layout version: it was made for the old layout.
  storage.setItem('hobkin-client-review', JSON.stringify({ state: { reviews: { [memoryKey(sample)]: { positions: { [node.id]: { x: 5, y: 5 } }, wires: {} } } }, version: 1 }))
  assert.deepEqual(positionOf(sample, storage, node.id), laidOut(sample, node.id), 'the old place is dropped')

  const memory = createReviewMemory(storage)
  assert.equal(memory.getState().of(sample).layout, LAYOUT_VERSION)
  memory.getState().moveNode(sample, node.id, { x: 40, y: 60 })
  assert.deepEqual(positionOf(sample, storage, node.id), { x: 40, y: 60 }, 'a place saved on the zones layout is kept')
  assert.deepEqual(positionOf(sample, storage, node.id), { x: 40, y: 60 }, 'and kept again: it is dropped only once')
})

test('a node moved on the graph that reads one way stays where the layout has it on the graph that reads the other', () => {
  const storage = memoryStorage()
  const memory = createReviewMemory(storage)
  const node = sample.nodes[3]!
  const placed = (flow: 'left-to-right' | 'top-to-bottom') => applyMemory(sample, createReviewMemory(storage).getState().of(sample), undefined, flow).nodes.find((each) => each.id === node.id)!.position
  const [across, down] = [placed('left-to-right'), placed('top-to-bottom')]
  assert.notDeepEqual(across, down, 'the two flows lay the node out in two places')

  memory.getState().moveNode(sample, node.id, { x: 70, y: 90 }, 'top-to-bottom')
  assert.deepEqual(placed('top-to-bottom'), { x: 70, y: 90 }, 'kept for the graph it was moved on')
  assert.deepEqual(placed('left-to-right'), across, 'and not on the other')
  memory.getState().moveNode(sample, node.id, { x: 10, y: 20 })
  assert.deepEqual([placed('left-to-right'), placed('top-to-bottom')], [{ x: 10, y: 20 }, { x: 70, y: 90 }], 'a move with no flow said is on the graph that reads left to right')

  // Putting the layout back forgets the moves on both.
  memory.getState().resetLayout(sample)
  assert.deepEqual([placed('left-to-right'), placed('top-to-bottom')], [across, down])
})
