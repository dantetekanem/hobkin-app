import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { pressKey } from '../src/features/review/keys.ts'
import { useAskedFocus } from '../src/features/review/outline/asked-focus.ts'
import { largeReview } from '../src/features/review/sample/large.ts'
import { createReviewMemory } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'
import { mountCounting } from './render-count.ts'

const keys = { panelKey: () => false, toggleSteps: () => {}, verdict: () => {}, proofKey: () => {} }

test('L asks for the keyboard in the outline each time it opens it, and not when it closes it', () => {
  const session = createSession(largeReview().review, createReviewMemory())
  const asked = () => session.getState().outlineAsked
  assert.equal(session.getState().outline, true, 'a review in Focus opens with the outline open')
  assert.equal(asked(), 0, 'and does not take the keyboard from the review for it')
  pressKey(session.getState(), { key: 'l', shift: false, alt: false }, keys)
  assert.deepEqual([session.getState().outline, asked()], [false, 0])
  pressKey(session.getState(), { key: 'l', shift: false, alt: false }, keys)
  assert.deepEqual([session.getState().outline, asked()], [true, 1])
  pressKey(session.getState(), { key: 'l', shift: false, alt: false }, keys)
  pressKey(session.getState(), { key: 'l', shift: false, alt: false }, keys)
  assert.equal(asked(), 2)
})

test("the outline's filter takes the keyboard when the press that opens the outline is what mounts it, and on each ask after", async () => {
  // The outline's body is drawn only while it is open: the ask and the mount come together.
  const field = { focused: 0, focus() { this.focused += 1 } }
  let asked = 1
  const Body = () => {
    useAskedFocus(asked, () => field)
    return null
  }
  const mounted = await mountCounting(() => createElement(Body))
  assert.equal(field.focused, 1, 'the filter takes the keyboard as the body mounts, so typed letters never reach the review')
  await mounted.change(() => {})
  assert.equal(field.focused, 1, 'drawing again without a new ask takes nothing')
  asked = 2
  await mounted.unmount()
  const again = await mountCounting(() => createElement(Body))
  assert.equal(field.focused, 2)
  await again.unmount()

  // Mounted with no ask, as a review in Focus opens with its outline open, it leaves the keyboard where it is.
  asked = 0
  const quiet = await mountCounting(() => createElement(Body))
  assert.equal(field.focused, 2)
  await quiet.unmount()
})
