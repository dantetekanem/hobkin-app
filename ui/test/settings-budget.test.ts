import assert from 'node:assert/strict'
import { test } from 'node:test'
import { budgetUse } from '../src/features/settings/rules.ts'

test('the budget bar fills with the share of the day used', () => {
  assert.deepEqual(budgetUse(25_000_000, 100_000_000), { share: 0.25, reached: false, line: '25M of 100M used today. Work mode stops starting new work when the day is used up.' })
  assert.equal(budgetUse(0, 100_000_000)!.share, 0)
  assert.equal(budgetUse(0, 100_000_000)!.line.startsWith('0 of 100M'), true, 'zero used is a figure, not a missing one')
})

test('a day that is used up says Work mode starts nothing new', () => {
  const full = budgetUse(100_000_000, 100_000_000)
  assert.equal(full!.reached, true)
  assert.equal(full!.line, '100M of 100M used today. Work mode starts nothing new until tomorrow.')

  const over = budgetUse(130_000_000, 100_000_000)
  assert.deepEqual([over!.share, over!.reached], [1, true], 'the bar stops at full')
})

test('usage hobkin has not reported is unavailable, not zero', () => {
  assert.equal(budgetUse(null, 100_000_000), null)
  assert.equal(budgetUse(5, null), null)
  assert.equal(budgetUse(5, 0), null)
})
