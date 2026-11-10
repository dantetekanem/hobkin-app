import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Review } from '#shared/review/types.ts'
import { applyMemory, createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const reopened = (storage: ReturnType<typeof memoryStorage>) => applyMemory(sample, createReviewMemory(storage).getState().of(sample))

test('confirming or removing a proposed wire persists', () => {
  const storage = memoryStorage()
  const memory = createReviewMemory(storage)
  const proposed = sample.edges.filter((edge) => edge.certainty === 'model')
  const [confirmed, removed, untouched] = [proposed[0]!, proposed[1]!, proposed[2]!]
  const derived = sample.edges.find((edge) => edge.certainty === 'host')!

  // As prepared: every wire the model proposed is drawn dashed, and none the host derived is.
  const before = reopened(storage)
  assert.equal(before.edges.length, sample.edges.length)
  assert.deepEqual(before.edges.filter((edge) => edge.proposed).map((edge) => edge.id), proposed.map((edge) => edge.id))

  memory.getState().decideWire(sample, confirmed.id, 'confirmed')
  memory.getState().decideWire(sample, removed.id, 'removed')

  // Closed and opened again.
  const after = reopened(storage)
  const wire = (id: string) => after.edges.find((edge) => edge.id === id)
  assert.equal(wire(confirmed.id)?.proposed, false, 'a confirmed wire is drawn solid')
  assert.equal(wire(confirmed.id)?.decision, 'confirmed')
  assert.equal(wire(removed.id), undefined, 'a removed wire is gone')
  assert.equal(wire(untouched.id)?.proposed, true)
  assert.equal(after.edges.length, sample.edges.length - 1)
  assert.deepEqual(after.removed.map((edge) => edge.id), [removed.id], 'and what was removed is still known, so it can come back')

  // A choice can be taken back.
  memory.getState().decideWire(sample, removed.id, null)
  assert.equal(reopened(storage).edges.length, sample.edges.length)
  assert.equal(reopened(storage).edges.find((edge) => edge.id === removed.id)?.proposed, true)

  // The graph is a view of the review: a wire the host derived cannot be removed or confirmed.
  memory.getState().decideWire(sample, derived.id, 'removed')
  memory.getState().decideWire(sample, 'not-a-wire', 'confirmed')
  assert.deepEqual(Object.keys(memory.getState().of(sample).wires), [confirmed.id])
  assert.ok(reopened(storage).edges.some((edge) => edge.id === derived.id))
})

test('a story step that rode a removed wire glides instead', () => {
  const storage = memoryStorage()
  const memory = createReviewMemory(storage)
  const ridden = sample.story.map((step) => step.travel).find((id) => sample.edges.find((edge) => edge.id === id)?.certainty === 'model')!

  memory.getState().decideWire(sample, ridden, 'removed')

  const view = reopened(storage)
  assert.equal(view.story.some((step) => step.travel === ridden), false)
  assert.equal(view.story.length, sample.story.length)
})
