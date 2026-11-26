import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cardFacts, type FiledCard } from '#shared/protocol/question.ts'

const DEADLINE = '2026-11-26T22:00:00.000Z'

/** A card as `hobkin decide` files it from a routine, with every card field it writes (null for one not given). */
const card = (over: Partial<FiledCard> = {}): FiledCard => ({
  choices: [
    { value: 'merge', label: 'Merge it' },
    { value: 'wait', label: 'Wait for a review' },
  ],
  recommended: 'merge',
  answerTo: { kind: 'routine' },
  sure: null,
  reversible: null,
  deadline: null,
  learn: null,
  ...over,
})

test('a card says how sure hobkin is of its pick, whether it can be undone, and that its last choice keeps a rule; one without them says nothing', () => {
  assert.deepEqual(cardFacts(card()), {}, 'null fields are fields not given')
  assert.deepEqual(cardFacts({ choices: card().choices }), {}, 'and so are fields a card filed before them never had')

  assert.deepEqual(cardFacts(card({ sure: 'medium', reversible: false })), { sure: 'medium', reversible: false })
  assert.deepEqual(cardFacts(card({ sure: 'medium', recommended: null })), {}, 'how sure is said of a pick, so a card without one says nothing of it')
  assert.deepEqual(cardFacts(card({ sure: 'certain', reversible: 'yes' })), {}, 'what hobkin does not write is not read')

  const learn = card({ learn: true, choices: [...card().choices, { value: 'always', label: 'Always: From now on, merge small fixes without asking.' }] })
  assert.deepEqual(cardFacts(learn), { learn: true })
  assert.deepEqual(cardFacts(card({ learn: true })), {}, 'a learn card whose rule choice is missing has no rule to show')
})

test('a reversible card from a routine or a work run takes its pick at its deadline, and only such a card says so', () => {
  const due = card({ reversible: true, deadline: DEADLINE })
  assert.deepEqual(cardFacts(due), { reversible: true, defaultsAt: DEADLINE })
  assert.equal(cardFacts({ ...due, answerTo: { kind: 'work' } }).defaultsAt, DEADLINE)

  // hobkin waits for the user on each of these (`isDueAt` in its decisions.mjs).
  assert.equal(cardFacts({ ...due, answerTo: { kind: 'outside' } }).defaultsAt, undefined, "another session's card")
  assert.equal(cardFacts({ ...due, answerTo: null }).defaultsAt, undefined, "hobkin's own question")
  assert.equal(cardFacts({ ...due, reversible: false }).defaultsAt, undefined, 'one that cannot be undone')
  assert.equal(cardFacts({ ...due, reversible: null }).defaultsAt, undefined, 'one that does not say')
  assert.equal(cardFacts({ ...due, recommended: null }).defaultsAt, undefined, 'one with no pick')
  assert.equal(cardFacts({ ...due, recommended: 'ship' }).defaultsAt, undefined, 'one whose pick is not among its choices')
  assert.equal(cardFacts({ ...due, deadline: 'tomorrow' }).defaultsAt, undefined, 'one with no time it can read')

  // hobkin's own word on it settles it, since it also knows the kinds it guards.
  assert.equal(cardFacts({ ...due, defaultsAt: null }).defaultsAt, undefined)
  assert.equal(cardFacts({ ...card(), defaultsAt: DEADLINE }).defaultsAt, DEADLINE)
})
