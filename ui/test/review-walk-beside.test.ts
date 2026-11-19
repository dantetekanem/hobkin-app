import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Review } from '#shared/review/types.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'
import { besideOf, focusNode, focusOf, goToStep, leaveFocus, offPath, startStory } from '../src/features/review/story/story.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const [first, second] = sample.nodes.filter((node) => node.kind === 'code').map((node) => node.id)
const opening = { ...sample.story.find((step) => step.kind === 'outcome')!, focus: [] }
const closing = { ...sample.story.find((step) => step.kind === 'closing')!, focus: [] }
const walk = (id: string, focus: string[]) => ({ ...sample.story.find((step) => step.kind === 'walk')!, id, focus, travel: undefined })
/** A walk with a step that has no node of its own between two that do. */
const review = { ...sample, story: [opening, walk('w1', [first!]), walk('w2', []), walk('w3', [second!]), closing] }

test('a step with no node of its own is told beside the node of the step before it, and the closing stays by the last node', () => {
  assert.deepEqual(besideOf(review, 0), [], 'only the opening shows the whole graph')
  assert.deepEqual(besideOf(review, 1), [first])
  assert.deepEqual(besideOf(review, 2), [first])
  assert.deepEqual(besideOf(review, 4), [second])

  const bare = goToStep(review, startStory(review), 2).state
  assert.deepEqual(focusOf(review, bare), [first], 'the camera stays where the walk is')
  assert.equal(offPath(review, bare), false, 'it is on the path')
  const pressed = focusNode(review, bare, first!).state
  assert.deepEqual([pressed.step, pressed.detour], [2, null], 'pressing that node is the step itself, not a detour')
  assert.equal(offPath(review, leaveFocus(review, bare)), true, 'leaving it for the whole graph is off the path')
})

test('with no step before it that has a node, the step after it lends its node', () => {
  const early = { ...review, story: [opening, walk('w2', []), walk('w3', [second!]), closing] }
  assert.deepEqual(besideOf(early, 1), [second])
})

test("a step told beside its neighbor's node offers no code of its neighbor's, while that neighbor's step does", () => {
  const session = createSession(review, createReviewMemory(memoryStorage()))
  session.getState().goTo(2)
  assert.deepEqual(session.getState().focus, [first])
  assert.equal(session.getState().openCode(), false)
  session.getState().goTo(1)
  assert.equal(session.getState().openCode(), true)
})
