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

test('a host that says nothing changed builds nothing on the first ask: its words are said, and the next press asks again and builds', async () => {
  const asked: unknown[] = []
  let started = 0
  const why = 'Nothing changed since this review, so it was not built: it costs a whole review. Ask again to build it.'
  const again = createReviewAgain({
    id: 'change:shop:c33e10',
    unchanged: false,
    command: async (_name, args) => {
      asked.push(args)
      return asked.length === 1 ? { again: { why } } : {}
    },
    started: () => (started += 1),
  })

  await again.press()
  assert.equal(again.getState().armed, true)
  assert.equal(again.said(), why, "the host's own words")
  assert.equal(started, 0, 'nothing was built')

  await again.press()
  assert.equal(asked.length, 2)
  assert.equal(started, 1)
  assert.equal(again.getState().armed, false)
  assert.equal(again.said(), null)
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

test('a row names its build button by its state: Rebuild for a review of an older commit, Review now for one waiting its turn, Review again for the rest', async () => {
  const { rowsOf, buildButton } = await import('../src/features/work/ai-reviews.ts')
  const head = '7d02c99f8c61be4291e0c2046d29787cbc1c010a'
  const base = { kind: 'change' as const, project: 'shop', head, state: 'ready' as const, phase: null, error: null, updatedAt: '2026-11-13T10:00:00Z' }
  const rows = rowsOf({
    reviews: [
      { ...base, id: 'change:shop:current', title: 'a', assessment: { state: 'ready', head } },
      { ...base, id: 'change:shop:older', title: 'b', outdated: { builtFor: '1111111111111111111111111111111111111111' }, assessment: { state: 'ready', head: '1111111111111111111111111111111111111111' } },
      { ...base, id: 'change:shop:waits', title: 'c', turn: { ahead: 2, why: 'Waits its turn: 2 ahead in shop.' }, assessment: { state: 'ready', head } },
      { ...base, id: 'change:shop:older-waits', title: 'd', outdated: { builtFor: '1111111111111111111111111111111111111111' }, turn: { ahead: 2, why: 'Waits its turn: 2 ahead in shop.' }, assessment: { state: 'ready', head: '1111111111111111111111111111111111111111' } },
    ],
  })
  const by = (id: string) => buildButton(rows.find((row) => row.item.id === id)!)
  assert.deepEqual(by('change:shop:current'), { word: 'Review again', now: false })
  assert.deepEqual(by('change:shop:older'), { word: 'Rebuild', now: false })
  assert.deepEqual(by('change:shop:waits'), { word: 'Review now', now: true })
  assert.deepEqual(by('change:shop:older-waits'), { word: 'Rebuild', now: false }, 'Rebuild builds it again at the change commit, as the review notice does, never a plain Review now')
})
