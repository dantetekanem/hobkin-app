import assert from 'node:assert/strict'
import { test } from 'node:test'
import { largeReview } from '../src/features/review/sample/large.ts'
import { createReviewMemory } from '../src/features/review/state/memory.ts'
import { forgetPlace, keepPlace, placeOf, resumedCamera } from '../src/features/review/state/place.ts'
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
  // A place whose step the review no longer has opens at the review's start, and its camera is not used.
  const gone = { ...session.getState().placeNow(), stepId: 'a step it no longer has' }
  const stale = createSession(large, memory, gone).getState()
  assert.equal(stale.story.step, 0)
  assert.equal(stale.resumed, false)
  assert.equal(resumedCamera({ ...gone, camera: { x: 1, y: 2, zoom: 1 } }, stale.resumed), null, 'no camera for a place not taken')
  const taken = createSession(large, memory, session.getState().placeNow()).getState()
  assert.equal(taken.resumed, true)
  assert.deepEqual(resumedCamera({ ...session.getState().placeNow(), camera: { x: 1, y: 2, zoom: 1 } }, taken.resumed), { x: 1, y: 2, zoom: 1 })
})

test('a story rewritten at the same commit while the reviewer was away: they come back on their step by its id, and their way back keeps only steps it still has', () => {
  const memory = createReviewMemory()
  const first = createSession(large, memory)
  const idAt = (session: typeof first, index: number) => session.getState().view.story[index]!.id
  first.getState().goTo(2)
  first.getState().goTo(5)
  first.getState().goTo(8)
  const left = first.getState()
  assert.deepEqual(left.history.back.map((entry) => idAt(first, entry.step)), ['outcome', 's2', 's5'])
  const place = left.placeNow()

  // The AI review landed while they were away: the same commit, a story with step s2 gone and the rest moved up.
  const rewritten = { ...large, story: large.story.filter((step) => step.id !== 's2') }
  const back = createSession(rewritten, memory, place)
  assert.equal(back.getState().resumed, true)
  assert.equal(idAt(back, back.getState().story.step), 's8', 'the same step, found by its id')
  assert.deepEqual(back.getState().history.back.map((entry) => idAt(back, entry.step)), ['outcome', 's5'], 'the way back skips the step that is gone')
  back.getState().historyBack()
  assert.equal(idAt(back, back.getState().story.step), 's5', ', goes back to where they were')
})
