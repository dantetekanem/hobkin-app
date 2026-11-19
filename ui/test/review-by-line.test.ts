import assert from 'node:assert/strict'
import { test } from 'node:test'
import { byLineWords, peopleOfOwner } from '../src/features/review/panel/by-line.ts'

test('the by-line says who a pull request is from, in words', () => {
  assert.equal(byLineWords({ author: { name: 'dev' } }), 'By dev')
  assert.equal(byLineWords({ author: { name: 'helper-bot' }, for: { name: 'Ana Souza' } }), 'By helper-bot, for Ana Souza')
  assert.equal(byLineWords({ author: null }), null)
  assert.equal(byLineWords(null), null)
  // What a review recorded of whose it is names its author.
  assert.equal(byLineWords(peopleOfOwner({ author: 'dev', mine: false })), 'By dev')
  assert.equal(byLineWords(peopleOfOwner({ author: null, mine: false })), null)
  assert.equal(byLineWords(peopleOfOwner(undefined)), null)
})
