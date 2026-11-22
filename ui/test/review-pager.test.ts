import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Review } from '#shared/review/types.ts'
import { pressKey } from '../src/features/review/keys.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { createSession, type SessionStore } from '../src/features/review/state/session.ts'
import { awayFrom, pagerOf } from '../src/features/review/story/pager.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const idOf = (title: string) => sample.nodes.find((node) => node.title === title)!.id
const effects = { panelKey: () => false, toggleSteps: () => {}, talk: () => {}, verdict: () => {}, proofKey: () => {} }

/** The pager as the bottom of the canvas draws it for a session. */
function pagerNow(session: SessionStore) {
  const { view, story, pendingDigits } = session.getState()
  return pagerOf({ steps: view.story, step: story.step, seen: story.seen, away: awayFrom(story), pending: pendingDigits })
}

test('the pager counts the steps and walks them: back and next one at a time, a position straight there', () => {
  const session = createSession(sample, createReviewMemory(memoryStorage()))
  const press = (key: string) => pressKey(session.getState(), { key, shift: false, alt: false }, effects)
  const total = sample.story.length
  const marked = (which: 'current' | 'seen') => pagerNow(session).positions.filter((position) => position[which]).map((position) => position.index)

  // It opens on the first step: a position for every step, the first current and seen, and nothing before it.
  let pager = pagerNow(session)
  assert.equal(pager.label, `Step 1 of ${total}`)
  assert.deepEqual(pager.positions.map((position) => position.title), sample.story.map((step) => step.title))
  assert.deepEqual([marked('current'), marked('seen')], [[0], [0]])
  assert.deepEqual([pager.back, pager.next], [false, true])

  // Next, by its button or the right arrow, is one step on, and each step reached is seen.
  session.getState().step(1)
  assert.equal(press('ArrowRight'), true)
  assert.equal(pagerNow(session).label, `Step 3 of ${total}`)
  assert.deepEqual([marked('current'), marked('seen')], [[2], [0, 1, 2]])

  // A position goes straight to its step, in one move, and the steps jumped over are not seen.
  session.getState().goTo(9)
  assert.equal(session.getState().move.kind, 'jump')
  assert.equal(pagerNow(session).label, `Step 10 of ${total}`)
  assert.deepEqual([marked('current'), marked('seen')], [[9], [0, 1, 2, 9]])

  // Back, by its button or the left arrow, is one step back.
  assert.equal(press('ArrowLeft'), true)
  assert.equal(pagerNow(session).label, `Step 9 of ${total}`)

  // Off the path, on a node of no step, both ways lead back: back to the step it left, next to the one after.
  session.getState().focusOn(idOf('CHANGELOG.md'))
  pager = pagerNow(session)
  assert.deepEqual([pager.away, pager.back, pager.next, pager.label], [true, true, true, `Step 9 of ${total}`])
  session.getState().step(-1)
  assert.deepEqual([pagerNow(session).away, pagerNow(session).label], [false, `Step 9 of ${total}`])

  // At the last step there is nowhere further.
  session.getState().goTo(total - 1)
  assert.deepEqual([pagerNow(session).back, pagerNow(session).next], [true, false])

  // A digit waiting for a second one shows in place of the count, until it is taken.
  assert.equal(press('1'), true)
  assert.equal(pagerNow(session).label, 'Go to 1…')
})
