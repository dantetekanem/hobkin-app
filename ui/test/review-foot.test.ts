import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createReviewRemoval, footOf, removeChoices } from '../src/features/review/panel/foot.ts'

const CHANGE = 'change:hobkin:7d02c9'
const PULL = 'pr:acme/shop/482'

test('the foot has the same four places for every review: the three verdicts in a fixed order, then Remove', () => {
  const places = (id: string, owner?: { author: string | null; mine: boolean }) => footOf(id, owner).slots.map(({ verdict, label, keys, offered }) => [verdict, label, keys ?? null, offered])
  assert.deepEqual(places(CHANGE), [['approve', 'Approve', 'A', true], ['approve-merge', 'Approve and merge', 'M', true], ['request-changes', 'Send fixes', 'X', true]])
  assert.deepEqual(places(PULL, { author: 'me', mine: true }), [['approve', 'Approve', 'A', true], ['approve-merge', 'Approve and merge', 'M', true], ['comment', 'Comment', null, true]])
  // Someone else's pull request keeps Approve and merge in its place, off, and says why.
  assert.deepEqual(places(PULL, { author: 'dev', mine: false }), [['approve', 'Approve', 'A', true], ['approve-merge', 'Approve and merge', 'M', false], ['comment', 'Comment', null, true]])
  assert.equal(footOf(PULL, { author: 'dev', mine: false }).why, 'This pull request is by dev: merging or closing it is left to them.')
  assert.equal(footOf(CHANGE).why, null)
})

test('Remove deletes the branch too for hobkin\'s own change and the user\'s own pull request, and only the review for another author\'s', () => {
  assert.equal(footOf(CHANGE).remove, 'both')
  assert.equal(footOf(PULL, { author: 'me', mine: true }).remove, 'both')
  assert.equal(footOf(PULL, { author: 'dev', mine: false }).remove, 'review')
  assert.equal(footOf(PULL).remove, 'review', 'a review from before the owner was recorded reads as someone else\'s')

  assert.deepEqual(removeChoices('both').map(({ label, sends }) => [label, sends]), [
    ['Remove it and delete the branch', { command: 'review.verdict', verdict: 'discard-branch' }],
    ['Only remove the review', { command: 'review.remove' }],
  ])
  assert.deepEqual(removeChoices('review').map(({ label, sends }) => [label, sends]), [['Remove the review', { command: 'review.remove' }]])
})

test('removing only the review is asked once in place: the first press sends nothing, the second sends review.remove, ten seconds take it back', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sent: unknown[] = []
  let gone = 0
  const removal = createReviewRemoval({ id: PULL, command: async (name, args) => void sent.push([name, args]), removed: () => void gone++ })

  removal.ask()
  assert.equal(removal.getState().asked, true)
  assert.deepEqual(sent, [])
  t.mock.timers.tick(10_000)
  assert.equal(removal.getState().asked, false, 'ten seconds without a second press take it back')
  assert.deepEqual(sent, [])

  removal.ask()
  await removal.run()
  assert.deepEqual(sent, [['review.remove', { id: PULL }]])
  assert.equal(gone, 1)
  assert.equal(removal.getState().asked, false)

  const refused = createReviewRemoval({ id: PULL, command: async () => { throw new Error('It is being prepared.') }, removed: () => void gone++ })
  await refused.run()
  assert.equal(refused.getState().error, 'It is being prepared.')
  assert.equal(gone, 1, 'a review that was not removed is not closed')
})
