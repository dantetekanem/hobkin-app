import assert from 'node:assert/strict'
import { test } from 'node:test'
import { largeReview } from '../src/features/review/sample/large.ts'
import { createReviewMemory } from '../src/features/review/state/memory.ts'
import { forgetPlace, keepPlace, placeOf } from '../src/features/review/state/place.ts'
import { createSession } from '../src/features/review/state/session.ts'

const large = largeReview().review

test('a review left for another page and opened again comes back to the same step, focus, history, groups and outline', () => {
  const memory = createReviewMemory()
  const first = createSession(large, memory)
  first.getState().goTo(4)
  const plan = first.getState().view.plan
  first.getState().openGroup(plan.order.find((id) => plan.groups[id]!.label === 'Docs')!)
  first.getState().goTo(5)
  first.getState().toggleOutline()
  const left = first.getState()

  const again = createSession(large, memory, left.placeNow())
  const back = again.getState()
  assert.equal(back.story.step, 5, 'the same step, not step 1')
  assert.deepEqual(back.focus, left.focus)
  assert.deepEqual(back.history, left.history)
  assert.ok(back.history.back.length > 0, 'and the way back through where the reviewer jumped')
  assert.deepEqual(back.fold, left.fold)
  assert.deepEqual(back.view.plan.open, left.view.plan.open)
  assert.equal(back.outline, false)
  assert.equal(back.mode, 'story')
})

test('Free Roam comes back as Free Roam, on the node it was on, with the code that was open', () => {
  const memory = createReviewMemory()
  const first = createSession(large, memory)
  first.getState().setMode('roam')
  const node = first.getState().view.nodes.find((entry) => entry.kind === 'code')!.id
  first.getState().focusOn(node)
  first.getState().openCode(node)

  const back = createSession(large, memory, first.getState().placeNow()).getState()
  assert.equal(back.mode, 'roam')
  assert.deepEqual(back.focus, [node])
  assert.equal(back.code, node)
})

test('a place is kept for a review at its commit while the window is open, and forgotten when the review is closed', () => {
  const memory = createReviewMemory()
  const session = createSession(large, memory)
  session.getState().goTo(2)
  keepPlace('host:/home:large@abc', { ...session.getState().placeNow(), camera: { x: 10, y: 20, zoom: 0.5 } })
  assert.equal(placeOf('host:/home:large@abc')?.story.step, 2)
  assert.deepEqual(placeOf('host:/home:large@abc')?.camera, { x: 10, y: 20, zoom: 0.5 })
  assert.equal(placeOf('host:/home:large@def'), null, 'another commit starts afresh')
  forgetPlace('host:/home:large@abc')
  assert.equal(placeOf('host:/home:large@abc'), null)
  // A place whose step the review no longer has opens at the review's start.
  const stale = createSession(large, memory, { ...session.getState().placeNow(), story: { ...session.getState().story, step: 999 } }).getState()
  assert.equal(stale.story.step, 0)
})
