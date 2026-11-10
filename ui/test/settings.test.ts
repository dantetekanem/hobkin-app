import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AGENTS, BUDGET, formatTokens, stepAgents, stepBudget } from '../src/features/settings/rules.ts'

test('agents stay between one and eight', () => {
  assert.equal(stepAgents(2, 1), 3)
  assert.equal(stepAgents(2, -1), 1)
  assert.equal(stepAgents(AGENTS.min, -1), AGENTS.min, 'stops at one')
  assert.equal(stepAgents(AGENTS.max, 1), AGENTS.max, 'stops at eight')
  assert.equal(stepAgents(40, 0), AGENTS.max, 'a value from outside is brought into range')
  assert.equal(stepAgents(0, 0), AGENTS.min)
})

test('the budget moves in steps and stays in range', () => {
  assert.equal(stepBudget(100_000_000, 1), 100_000_000 + BUDGET.step)
  assert.equal(stepBudget(100_000_000, -1), 100_000_000 - BUDGET.step)
  assert.equal(stepBudget(BUDGET.min, -1), BUDGET.min, 'stops at the least')
  assert.equal(stepBudget(BUDGET.max, 1), BUDGET.max, 'stops at the most')
})

test('a budget between steps snaps to the nearest step', () => {
  assert.equal(stepBudget(BUDGET.min + BUDGET.step * 3 + 4_000_000, 0), BUDGET.min + BUDGET.step * 3)
  assert.equal(stepBudget(BUDGET.min + BUDGET.step * 3 + 6_000_000, 0), BUDGET.min + BUDGET.step * 4)
})

test('tokens are written the way a person says them', () => {
  assert.equal(formatTokens(100_000_000), '100M')
  assert.equal(formatTokens(25_000_000), '25M')
  assert.equal(formatTokens(1_500_000), '1.5M')
  assert.equal(formatTokens(950_000), '950K')
  assert.equal(formatTokens(0), '0')
})
