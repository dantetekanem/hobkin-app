import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ModelChoice } from '#shared/tiers/tiers.ts'
import { runsOnFull, runsOnWords, tierName } from '../src/features/teams/runs-on.ts'

const luna: ModelChoice = { id: 'openai-codex/gpt-6-luna', name: 'GPT-6 Luna', provider: 'OpenAI', efforts: ['high', 'max'] }

test("a subagent's tier reads as the dock's pill names one: hobkin's by its label, a teams tier by its own name", () => {
  assert.equal(tierName('high'), 'High tier')
  assert.equal(tierName('fast'), 'Fast tier')
  assert.equal(tierName('read-collect'), 'Read-collect tier')
  assert.equal(tierName('write-critical'), 'Write-critical tier')
  assert.equal(tierName(undefined), null)
  assert.equal(tierName(''), null)
})

test('what a subagent runs on, in a row: its tier, its model by the name the window gives it, and its thinking level', () => {
  assert.deepEqual(runsOnWords({ modelSlot: 'read-collect', model: luna.id, thinking: 'max' }, [luna]), ['Read-collect tier', 'GPT-6 Luna', 'max thinking'])
  assert.deepEqual(runsOnWords({ modelSlot: 'write-critical', model: 'claude-opus-5-5', thinking: 'max' }, []), ['Write-critical tier', 'claude-opus-5-5', 'max thinking'])
  assert.deepEqual(runsOnWords({ model: 'anthropic/claude-sonnet-5', thinking: 'off' }, []), ['claude-sonnet-5', 'thinking off'])
  assert.deepEqual(runsOnWords({ modelSlot: 'mid' }, [luna]), ['Mid tier'], 'what is not known is left out')
  assert.deepEqual(runsOnWords({}, [luna]), [])
})

test('what a subagent runs on, in full for a hover, as the pill says it: the tier, then the whole model at its level', () => {
  assert.equal(runsOnFull({ modelSlot: 'read-collect', model: luna.id, thinking: 'max' }), 'Read-collect tier: openai-codex/gpt-6-luna at max')
  assert.equal(runsOnFull({ modelSlot: 'read-review', model: luna.id }), 'Read-review tier: openai-codex/gpt-6-luna')
  assert.equal(runsOnFull({ model: luna.id, thinking: 'high' }), 'openai-codex/gpt-6-luna at high')
  assert.equal(runsOnFull({ modelSlot: 'high', thinking: 'high' }), 'High tier: high thinking')
  assert.equal(runsOnFull({ modelSlot: 'write-patch' }), 'Write-patch tier')
  assert.equal(runsOnFull({}), '')
})
