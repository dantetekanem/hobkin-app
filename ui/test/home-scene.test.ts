import assert from 'node:assert/strict'
import test from 'node:test'
import { cardText } from '../src/features/home/scene.ts'
import type { StackCard } from '../src/features/home/types.ts'

const card = (rest: Partial<StackCard> = {}): StackCard => ({
  id: 'decision:x', kind: 'decision', label: 'Decision · hobkin', reason: 'Waiting 2 hours', tone: 'accent', mood: 'listening',
  title: 'Take the update?', detail: null, next: null, facts: [], choices: [], pick: null, why: null,
  primary: { label: 'Decide', target: { to: 'action', id: 'x' } }, secondary: null,
  ...rest,
})

test('a stage card says its detail and next step in one passage, and its facts, pick and choices as short chips', () => {
  assert.deepEqual(cardText(card({
    detail: 'It changes how invoices round.',
    next: 'Run the billing tests.',
    facts: [{ label: 'Size', value: '3 lines · 1 file', tone: 'quiet' }, { label: 'Behind', value: '2 commits', tone: 'warn' }],
    pick: 'Hold it',
    choices: ['Take it now', 'Hold it'],
  })), {
    detail: 'It changes how invoices round. Next: Run the billing tests.',
    chips: ['Size 3 lines · 1 file', 'Behind 2 commits', 'hobkin suggests Hold it', 'You choose from: Take it now · Hold it'],
  })
})

test('a detail that does not end a sentence gets a full stop before the next step', () => {
  assert.equal(cardText(card({ detail: 'Morning collection', next: 'Refresh the token.' })).detail, 'Morning collection. Next: Refresh the token.')
  assert.equal(cardText(card({ detail: 'Is it safe?', next: 'Ask.' })).detail, 'Is it safe? Next: Ask.')
})

test('without a detail or next step, a stage card says why the user decides, or nothing', () => {
  assert.deepEqual(cardText(card({ next: 'Fix it' })).detail, 'Next: Fix it')
  assert.deepEqual(cardText(card({ why: 'Only you know the budget.' })).detail, 'Only you know the budget.')
  assert.deepEqual(cardText(card()), { detail: null, chips: [] })
})
