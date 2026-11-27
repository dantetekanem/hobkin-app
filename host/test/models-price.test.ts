import assert from 'node:assert/strict'
import { test } from 'node:test'
import { modelChoiceOf } from '../src/model-access.ts'

test("the models slice carries Pi's price for a model, when Pi knows one", () => {
  const priced = modelChoiceOf({ id: 'sol', provider: 'p', name: 'Sol', contextWindow: 1000, cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 0 } }, ['low'])
  assert.deepEqual(priced, { id: 'sol', provider: 'p', name: 'Sol', thinking: ['low'], contextWindow: 1000, cost: { input: 2, output: 10 } })
  // Pi says nothing costs nothing when it knows no price, as for a model of a provider's own extension.
  assert.equal('cost' in modelChoiceOf({ id: 'free', provider: 'p', name: 'Free', cost: { input: 0, output: 0 } }, ['off']), false)
  assert.equal('cost' in modelChoiceOf({ id: 'plain', provider: 'p', name: 'Plain' }, ['off']), false)
})
