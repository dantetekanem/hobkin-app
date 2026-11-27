import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ModelsState, ProviderAccess } from '../../shared/protocol/models.ts'
import { connectedLater } from '../src/features/signin/connect.ts'

const provider = (id: string, connected: boolean): ProviderAccess => ({ id, name: id, connected })
const slice = (connected: string[], ids = ['anthropic', 'openai-codex']): ModelsState => ({
  providers: ids.map((id) => provider(id, connected.includes(id))),
  models: connected.map((id) => ({ id: `${id}-model`, provider: id, name: 'Model', thinking: ['off'], contextWindow: null })),
})

test('the provider that gave hobkin its first usable model is the news, and nothing else is', () => {
  const none = { models: slice([]) }
  const codex = { models: slice(['openai-codex']) }
  const both = { models: slice(['openai-codex', 'anthropic']) }

  assert.equal(connectedLater(none, codex), 'openai-codex')
  assert.equal(connectedLater(none, both), 'anthropic', "two at once: the first in Pi's order")
  // A second provider while one already answers: Connect a model was not up.
  assert.equal(connectedLater(codex, both), null)
  assert.equal(connectedLater(none, none), null)
  // The first slice the host sends is where things stand, not news.
  assert.equal(connectedLater({ models: null }, codex), null)
})

test('a provider that turns connected without a model Pi lists for it is not the news', () => {
  const none = { models: slice([]) }
  const keyOnly: ModelsState = { providers: [provider('anthropic', true), provider('openai-codex', true)], models: [{ id: 'm', provider: 'openai-codex', name: 'M', thinking: ['off'], contextWindow: null }] }

  assert.equal(connectedLater(none, { models: keyOnly }), 'openai-codex')
})
