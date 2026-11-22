import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Review } from '#shared/review/types.ts'
import { pressKey } from '../src/features/review/keys.ts'
import { largeReview } from '../src/features/review/sample/large.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const large = largeReview().review
const keys = { panelKey: () => false, toggleSteps: () => {}, verdict: () => {}, openModelRun: () => {} }
const press = (session: ReturnType<typeof createSession>, key: string) => pressKey(session.getState(), { key, shift: false, alt: false }, keys)
const at = (session: ReturnType<typeof createSession>, stepId: string) => session.getState().view.stepOf[stepId]!

test('a node is seen when its step is visited, when its code is opened, or when Z marks it; Z again takes the mark off', () => {
  const session = createSession(sample, createReviewMemory())
  assert.equal(session.getState().seen.size, 0, 'nothing is seen on opening')

  session.getState().goTo(at(session, 's3'))
  assert.deepEqual(session.getState().focus, ['u4'])
  assert.ok(session.getState().seen.has('u4'), 'its step was visited')

  // A node looked at on a detour is not seen until its code is opened.
  const other = sample.nodes.find((node) => node.kind === 'code' && node.id !== 'u4' && !session.getState().seen.has(node.id))!
  session.getState().focusOn(other.id)
  assert.equal(session.getState().seen.has(other.id), false)
  press(session, 'Enter')
  assert.equal(session.getState().code, other.id)
  assert.ok(session.getState().seen.has(other.id), 'its code was opened')

  session.getState().closeCode()
  const third = sample.nodes.find((node) => node.kind === 'code' && !session.getState().seen.has(node.id))!
  session.getState().focusOn(third.id)
  press(session, 'z')
  assert.ok(session.getState().seen.has(third.id), 'Z marked it')
  press(session, 'z')
  assert.equal(session.getState().seen.has(third.id), false, 'Z again took the mark off')
})

test('Z on a group card marks every node it holds seen, and again takes the marks off', () => {
  const session = createSession(large, createReviewMemory())
  const plan = session.getState().view.plan
  const docs = plan.groups[plan.order.find((id) => plan.groups[id]!.label === 'Docs')!]!
  session.getState().focusOn(docs.id)
  press(session, 'z')
  for (const id of docs.members) assert.ok(session.getState().seen.has(id), `${id} is seen`)
  press(session, 'z')
  for (const id of docs.members) assert.equal(session.getState().seen.has(id), false)
})

test('marks are kept for each commit: a newer commit keeps the mark on code it did not change, and drops the mark on code it did', () => {
  const storage = memoryStorage()
  const memory = createReviewMemory(storage)
  const first = createSession(sample, memory)
  first.getState().focusOn('u4')
  press(first, 'z')
  const kept = sample.nodes.find((node) => node.kind === 'code' && node.id !== 'u4')!
  first.getState().focusOn(kept.id)
  press(first, 'z')
  assert.ok(first.getState().seen.has('u4') && first.getState().seen.has(kept.id))

  // The next commit changed u4's lines and left the other node's as they were.
  const changed = sample.nodes.find((node) => node.id === 'u4')!
  const newer: Review = {
    ...sample,
    snapshot: 'f'.repeat(64),
    nodes: sample.nodes.map((node) => (node.id === 'u4' ? { ...node, anchors: changed.anchors.map((anchor) => ({ ...anchor, hash: '0'.repeat(64) })) } : node)),
  }
  const next = createSession(newer, memory)
  assert.equal(next.getState().seen.has('u4'), false, 'its code changed, so the mark went')
  assert.ok(next.getState().seen.has(kept.id), 'its code did not, so the mark stayed')

  // The marks are the review's memory: they are there when the window opens again.
  const reopened = createSession(newer, createReviewMemory(storage))
  assert.ok(reopened.getState().seen.has(kept.id))
  // And the older commit keeps its own.
  assert.ok(createSession(sample, createReviewMemory(storage)).getState().seen.has('u4'))
})
