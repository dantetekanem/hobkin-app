import assert from 'node:assert/strict'
import test from 'node:test'
import { visibleCardId, type StackSelection } from '../src/features/home/stack-selection.ts'

test('empty stacks have no visible card, even with a previous choice', () => {
  assert.equal(visibleCardId([], null, 0), null)
  assert.equal(visibleCardId([], { id: 'old', at: 0 }, 1), null)
})

test('the current top takes over without a manual choice', () => {
  assert.equal(visibleCardId(['first', 'second'], null, 0), 'first')
  assert.equal(visibleCardId(['new', 'first', 'second'], null, 1), 'new')
})

test('a manual choice holds for less than thirty seconds, including a new top', () => {
  const choice = { id: 'second', at: 100 }
  assert.equal(visibleCardId(['first', 'second'], choice, 100), 'second')
  assert.equal(visibleCardId(['new', 'first', 'second'], choice, 30_099), 'second')
})

test('disappearing choices return to the current top immediately', () => {
  assert.equal(visibleCardId(['new', 'first'], { id: 'second', at: 100 }, 101), 'new')
})

test('exact expiry yields to the latest top and reselection starts a fresh lock', () => {
  let now = 100
  let selected: StackSelection = { id: 'second', at: now }
  const ids = ['new', 'second']
  now += 30_000
  assert.equal(visibleCardId(ids, selected, now), 'new')
  selected = { id: 'second', at: now }
  now += 29_999
  assert.equal(visibleCardId(ids, selected, now), 'second')
  now += 1
  assert.equal(visibleCardId(ids, selected, now), 'new')
})

test('selection follows current IDs rather than retaining an old card object', () => {
  const selected = { id: 'second', at: 0 }
  const cards = [{ id: 'first', title: 'First' }, { id: 'second', title: 'Updated title' }]
  const id = visibleCardId(cards.map(card => card.id), selected, 1)
  assert.equal(cards.find(card => card.id === id)?.title, 'Updated title')
})
