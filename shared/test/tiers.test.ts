import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkArguments, MAIN_EFFORTS } from '../commands/registry.ts'
import { clampEffort, EFFORTS, filterModels, resolveTier, setTierModel, type ModelChoice, type TiersConfig } from '../tiers/tiers.ts'

const MODELS: ModelChoice[] = [
  { id: 'openai/quick', name: 'quick', provider: 'OpenAI', efforts: ['minimal', 'low', 'medium'] },
  { id: 'openai/steady', name: 'steady', provider: 'OpenAI', efforts: ['low', 'medium', 'high', 'xhigh'] },
  { id: 'anthropic/deep', name: 'deep', provider: 'Anthropic', efforts: ['medium', 'high', 'xhigh'] },
]

const CONFIG: TiersConfig = {
  lead: { model: 'openai/steady', effort: 'medium' },
  tiers: { fast: { model: 'openai/quick', effort: 'low' }, mid: null, high: null, max: { model: 'anthropic/deep', effort: 'xhigh' } },
}

test('a tier that is set resolves to its own model and effort', () => {
  assert.deepEqual(resolveTier(CONFIG, 'fast'), { model: 'openai/quick', effort: 'low', followsLead: false })
  assert.deepEqual(resolveTier(CONFIG, 'max'), { model: 'anthropic/deep', effort: 'xhigh', followsLead: false })
})

test('an unset tier follows the lead', () => {
  assert.deepEqual(resolveTier(CONFIG, 'mid'), { model: 'openai/steady', effort: 'medium', followsLead: true })
  assert.deepEqual(resolveTier(CONFIG, 'high'), { model: 'openai/steady', effort: 'medium', followsLead: true })
})

test('an effort the model supports is kept', () => {
  assert.equal(clampEffort(MODELS[1]!, 'high'), 'high')
})

test('an effort the model lacks moves to the nearest one it supports', () => {
  assert.equal(clampEffort(MODELS[0]!, 'xhigh'), 'medium', 'down to the strongest it has')
  assert.equal(clampEffort(MODELS[2]!, 'minimal'), 'medium', 'up to the weakest it has')
  assert.equal(clampEffort({ ...MODELS[0]!, efforts: ['low', 'high'] }, 'medium'), 'low', 'a tie goes to the lower effort, which costs less')
})

test('choosing a model for a tier clamps the effort and says when it moved', () => {
  const kept = setTierModel(CONFIG, 'fast', MODELS[1]!)
  assert.deepEqual(kept.config.tiers.fast, { model: 'openai/steady', effort: 'low' })
  assert.equal(kept.effortMovedFrom, null)

  const moved = setTierModel(CONFIG, 'max', MODELS[0]!)
  assert.deepEqual(moved.config.tiers.max, { model: 'openai/quick', effort: 'medium' })
  assert.equal(moved.effortMovedFrom, 'xhigh')

  assert.deepEqual(CONFIG.tiers.max, { model: 'anthropic/deep', effort: 'xhigh' }, 'the config passed in is not changed')
})

test('choosing a model for a tier that followed the lead starts from the lead\'s effort', () => {
  const result = setTierModel(CONFIG, 'mid', MODELS[2]!)
  assert.deepEqual(result.config.tiers.mid, { model: 'anthropic/deep', effort: 'medium' })
})

test('choosing a model for the lead clamps the lead\'s effort', () => {
  const result = setTierModel({ ...CONFIG, lead: { model: 'openai/steady', effort: 'xhigh' } }, 'lead', MODELS[0]!)
  assert.deepEqual(result.config.lead, { model: 'openai/quick', effort: 'medium' })
  assert.equal(result.effortMovedFrom, 'xhigh')
})

test('the model list filters by name and by provider, ignoring case', () => {
  assert.deepEqual(filterModels(MODELS, 'STEA').map((model) => model.id), ['openai/steady'])
  assert.deepEqual(filterModels(MODELS, 'anthropic').map((model) => model.id), ['anthropic/deep'])
  assert.deepEqual(filterModels(MODELS, 'openai').map((model) => model.id), ['openai/quick', 'openai/steady'])
  assert.deepEqual(filterModels(MODELS, '  ').length, 3, 'an empty search shows everything')
  assert.deepEqual(filterModels(MODELS, 'nothing like this'), [])
})

test('several words must all match', () => {
  assert.deepEqual(filterModels(MODELS, 'openai quick').map((model) => model.id), ['openai/quick'])
})

test('the thinking levels are Pi\'s seven, weakest first, and the ones the host accepts for hobkin', () => {
  // MODEL_THINKING_LEVELS in pi-ai's providers/model-schema.
  assert.deepEqual([...EFFORTS], ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual([...EFFORTS], [...MAIN_EFFORTS])
})

test('a model that thinks at max keeps max, and one that stops at xhigh moves down to it', () => {
  const deepest: ModelChoice = { id: 'anthropic/deepest', name: 'deepest', provider: 'Anthropic', efforts: ['off', 'low', 'medium', 'high', 'xhigh', 'max'] }
  assert.equal(clampEffort(deepest, 'max'), 'max')
  assert.equal(clampEffort(MODELS[2]!, 'max'), 'xhigh')

  const kept = setTierModel({ ...CONFIG, tiers: { ...CONFIG.tiers, max: { model: 'anthropic/deepest', effort: 'max' } } }, 'max', deepest)
  assert.deepEqual(kept.config.tiers.max, { model: 'anthropic/deepest', effort: 'max' })
  assert.equal(kept.effortMovedFrom, null)
})

test('the host takes max for a tier, for hobkin\'s own model and for a durable hobkin on a model of its own', () => {
  const model = 'anthropic/deepest'
  assert.deepEqual(checkArguments('tiers.apply', { tiers: { max: { model, effort: 'max' } } }), { ok: true })
  assert.deepEqual(checkArguments('models.select', { model, effort: 'max' }), { ok: true })
  assert.deepEqual(checkArguments('hobkin.start', { cwd: '~', engine: { kind: 'pi', model, effort: 'max' } }), { ok: true })
  assert.equal(checkArguments('tiers.apply', { tiers: { max: { model, effort: 'turbo' } } }).ok, false, 'a level Pi does not name is refused')
})
