import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commandFor } from '../src/features/work/actions.ts'
import { applySample } from '../src/features/work/sample-actions.ts'
import { sampleWork } from '../src/features/work/sample.ts'

const leftCards = (work = sampleWork()) => work.finished.find(({ name }) => name === 'left')?.changes ?? []

test("Close without merging on a Left for you card is hobkin's own done, and pins no commit because nothing merges", () => {
  const [change] = leftCards()
  assert.ok(change, 'the sample has a Left for you card')
  assert.deepEqual(commandFor({ do: 'change', change, choice: 'done' }), { name: 'work.change', args: { slug: change.slug, item: change.item, action: 'done' } })
})

test('a Left for you card offers no merge: only its review, a note back to the agent, and closing it', () => {
  assert.ok(leftCards().length > 0)
  for (const change of leftCards()) {
    assert.ok(change.left, `${change.key} carries its note`)
    assert.ok(
      change.choices.every(({ value }) => ['diff', 'open', 'done'].includes(value)),
      `${change.key}: ${change.choices.map(({ value }) => value).join(', ')}`,
    )
  }
})

test('with no host, closing one answers as hobkin does and the card leaves; the group goes with its last card', () => {
  const work = sampleWork()
  const [change, ...others] = leftCards(work)

  const outcome = applySample(work, { do: 'change', change: change!, choice: 'done' })

  assert.ok('state' in outcome)
  assert.equal(outcome.message, `"${change!.title}" on ${change!.project} is done. It leaves the queue, and any branch or PR stays as it is.`)
  assert.deepEqual(
    leftCards(outcome.state).map(({ key }) => key),
    others.map(({ key }) => key),
  )

  const closeAll = leftCards(work).reduce((state, card) => {
    const next = applySample(state, { do: 'change', change: card, choice: 'done' })
    return 'state' in next ? next.state : state
  }, work)
  assert.equal(closeAll.finished.some(({ name }) => name === 'left'), false)
})
