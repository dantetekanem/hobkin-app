import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Review } from '#shared/review/types.ts'
import { pressKey } from '../src/features/review/keys.ts'
import { largeReview } from '../src/features/review/sample/large.ts'
import { createReviewMemory } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const large = largeReview().review
const keys = { panelKey: () => false, toggleSteps: () => {}, verdict: () => {}, proofKey: () => {} }
const press = (session: ReturnType<typeof createSession>, key: string, shift = false) => pressKey(session.getState(), { key, shift, alt: false }, keys)
const needsYou = large.nodes.filter((node) => node.attention?.tier === 'needs-you').sort((a, b) => a.attention!.rank - b.attention!.rank).map((node) => node.id)

test('U goes to the next node that needs the reviewer and is not seen, and Shift+U to the one before', () => {
  const session = createSession(large, createReviewMemory())
  press(session, 'u')
  assert.deepEqual(session.getState().focus, [needsYou[0]])
  press(session, 'u')
  assert.deepEqual(session.getState().focus, [needsYou[1]])
  press(session, 'U', true)
  assert.deepEqual(session.getState().focus, [needsYou[0]])

  // What is seen is passed over.
  session.getState().toggleSeen(needsYou[1])
  session.getState().toggleSeen(needsYou[2])
  press(session, 'u')
  assert.deepEqual(session.getState().focus, [needsYou[3]])
  // From the first, back goes round to the last.
  session.getState().focusOn(needsYou[0]!)
  press(session, 'U', true)
  assert.deepEqual(session.getState().focus, [needsYou.at(-1)])
})

test('U says so when every node that needs the reviewer is seen, and stays where it is', () => {
  const session = createSession(large, createReviewMemory())
  for (const id of needsYou) session.getState().toggleSeen(id)
  session.getState().focusOn(needsYou[2]!)
  press(session, 'u')
  assert.deepEqual(session.getState().focus, [needsYou[2]])
  assert.equal(session.getState().notice?.text, 'Every node that needs you is seen.')
  const said = session.getState().notice!.key
  press(session, 'u')
  assert.equal(session.getState().notice!.key, said + 1, 'said again on each press')
})

test('a review that says nothing of what needs the reviewer says that on U', () => {
  const session = createSession(sample, createReviewMemory())
  const before = session.getState().focus
  assert.equal(press(session, 'u'), true)
  assert.deepEqual(session.getState().focus, before)
  assert.equal(session.getState().notice?.text, 'This review does not say what needs you.')
})
