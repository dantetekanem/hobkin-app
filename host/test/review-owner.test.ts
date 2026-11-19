import assert from 'node:assert/strict'
import { test } from 'node:test'
import { whosePull } from '../src/review/owner.ts'

const ME = { viewer: 'Dev', emails: ['dev@example.invalid'], agents: ['helper-bot[bot]'] }

test('a pull request is the user’s when they wrote it, by their login or one of their addresses', () => {
  assert.deepEqual(whosePull({ author: 'dev', description: '' }, ME), { author: 'dev', mine: true }, 'logins do not care about case')
  assert.deepEqual(whosePull({ author: 'Dev@Example.invalid', description: '' }, ME), { author: 'Dev@Example.invalid', mine: true })
  assert.deepEqual(whosePull({ author: 'someone', description: 'Requested by dev@example.invalid' }, ME), { author: 'someone', mine: false }, 'only an agent opens one for somebody')
})

test('a pull request an agent opened is the user’s when the first "requested by" line names one of their addresses, never one after "modified by"', () => {
  const agent = (description: string) => whosePull({ author: 'Helper-Bot[bot]', description }, ME)
  assert.equal(agent('Adds the retry.\n\nRequested by: Dev <dev@example.invalid>\nRequested by: other@example.invalid').mine, true)
  assert.equal(agent('Requested by other@example.invalid, modified by dev@example.invalid').mine, false)
  assert.equal(agent('Requested by other@example.invalid\nRequested by dev@example.invalid').mine, false, 'only the first such line counts')
  assert.equal(agent('Adds the retry.').mine, false)
})

test('a pull request nobody can place is someone else’s', () => {
  assert.deepEqual(whosePull({ author: null, description: 'Requested by dev@example.invalid' }, ME), { author: null, mine: false })
  assert.deepEqual(whosePull({ author: 'dev', description: '' }, { viewer: null }), { author: 'dev', mine: false })
})
