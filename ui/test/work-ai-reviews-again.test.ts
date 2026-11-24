import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createReviewAgain, NOTHING_CHANGED } from '../src/features/work/review-row-actions.ts'

/** A host that records what it was asked, and the list hears each review started. */
function fakeHost() {
  const asked: { name: string; args: unknown }[] = []
  let started = 0
  const command = async (name: string, args: unknown) => {
    asked.push({ name, args })
    return {}
  }
  return { asked, command, started: () => (started += 1), count: () => started }
}

test('Review again with nothing changed since the review says what it costs first, and builds it on the second press', async () => {
  const host = fakeHost()
  const again = createReviewAgain({ id: 'change:shop:carried', unchanged: true, command: host.command, started: host.started })

  await again.press()
  assert.deepEqual(again.getState(), { armed: true, busy: false, error: null })
  assert.equal(again.said(), NOTHING_CHANGED)
  assert.equal(NOTHING_CHANGED, 'Nothing changed since this review. It costs a whole review again.')
  assert.deepEqual(host.asked, [], 'nothing is built on the first press')

  await again.press()
  assert.deepEqual(host.asked, [{ name: 'review.prepare', args: { id: 'change:shop:carried', refresh: true } }])
  assert.equal(host.count(), 1)
  assert.deepEqual(again.getState(), { armed: false, busy: false, error: null })
  assert.equal(again.said(), null)
  again.cancel()
})

test('Review again on a change that moved, or a review that stopped, builds it on the first press; Review now builds a waiting one', async () => {
  const host = fakeHost()
  const moved = createReviewAgain({ id: 'change:shop:old', unchanged: false, command: host.command, started: host.started })
  await moved.press()
  assert.deepEqual(host.asked, [{ name: 'review.prepare', args: { id: 'change:shop:old', refresh: true } }])

  const now = createReviewAgain({ id: 'change:shop:w1', unchanged: false, now: true, command: host.command, started: host.started })
  await now.press()
  assert.deepEqual(host.asked.at(-1), { name: 'review.prepare', args: { id: 'change:shop:w1' } })
  assert.equal(host.count(), 2)
})

test('a press the host refuses says why, and Escape takes back the one that waits', async () => {
  const refusing = createReviewAgain({
    id: 'change:shop:old',
    unchanged: false,
    command: async () => {
      throw new Error('The review tree is busy.')
    },
    started: () => {},
  })
  await refusing.press()
  assert.equal(refusing.getState().error, 'The review tree is busy.')

  const waiting = createReviewAgain({ id: 'change:shop:carried', unchanged: true, command: async () => ({}), started: () => {} })
  await waiting.press()
  waiting.cancel()
  assert.equal(waiting.getState().armed, false)
})
