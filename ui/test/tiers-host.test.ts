import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_REVIEW_TIERS, type HostTiers, type ModelChoice } from '#shared/tiers/tiers.ts'
import { HOBKIN_FOLLOWS, LEAD_FOLLOWS, followsWords, fromHost, migrateSavedTiers, modelName, ownSetting, shownTier, tiersChange, type TiersView } from '../src/features/tiers/host-tiers.ts'

const HOST: HostTiers = {
  lead: { model: 'openai/steady', effort: 'medium' },
  tiers: {
    fast: { model: 'openai/quick', effort: 'low', follows: 'background' },
    mid: { model: 'openai/steady', effort: 'medium', follows: 'main' },
    high: { model: 'anthropic/deep', effort: 'high', follows: null },
    max: { model: 'anthropic/deep', effort: 'xhigh', follows: null },
  },
  review: { reviewer: 'max', quick: 'mid' },
}

/** What the window showed before hobkin answered. */
const SHOWN: TiersView = {
  config: { lead: { model: 'openai/window', effort: 'low' }, tiers: { fast: null, mid: null, high: null, max: null } },
  review: DEFAULT_REVIEW_TIERS,
  follows: LEAD_FOLLOWS,
  checks: null,
}

test("hobkin's tiers become the window's: a tier with a model of its own keeps it, and one that follows is unset", () => {
  const view = fromHost(HOST, SHOWN)

  assert.deepEqual(view.config, {
    lead: { model: 'openai/steady', effort: 'medium' },
    tiers: { fast: null, mid: null, high: { model: 'anthropic/deep', effort: 'high' }, max: { model: 'anthropic/deep', effort: 'xhigh' } },
  })
  assert.deepEqual(view.review, { reviewer: 'max', quick: 'mid' })
  assert.deepEqual(view.follows, { fast: 'background', mid: 'main', high: 'main', max: 'main' }, 'a tier with its own model would follow by hobkin’s rule')
  assert.deepEqual(view.checks, { model: 'openai/quick', effort: 'low' }, 'a tier that follows the checks says what they run with')
})

test('a lead hobkin has no model for keeps the lead the window shows', () => {
  const view = fromHost({ ...HOST, lead: { model: null, effort: 'high' } }, SHOWN)

  assert.deepEqual(view.config.lead, SHOWN.config.lead)
})

test('the checks model the window knew stays when no tier follows the checks now', () => {
  const own = { ...HOST, tiers: { ...HOST.tiers, fast: { model: 'openai/quick', effort: 'minimal' as const, follows: null } } }
  const known = { model: 'openai/older', effort: 'low' as const }

  assert.deepEqual(fromHost(own, { ...SHOWN, checks: known }).checks, known)
  assert.equal(fromHost(own, SHOWN).checks, null)
  assert.deepEqual(fromHost(own, SHOWN).follows.fast, HOBKIN_FOLLOWS.fast)
})

test('only what changed is sent, and a tier set to follow again is sent as null', () => {
  const saved = fromHost(HOST, SHOWN)
  const draft = {
    config: { ...saved.config, tiers: { ...saved.config.tiers, mid: { model: 'openai/quick', effort: 'low' as const }, high: null } },
    review: { ...saved.review, quick: 'fast' as const },
  }

  assert.deepEqual(tiersChange(saved, draft), { tiers: { mid: { model: 'openai/quick', effort: 'low' }, high: null }, review: { quick: 'fast' } })
})

test('a change to one part sends only that part, and nothing changed is no change at all', () => {
  const saved = fromHost(HOST, SHOWN)
  const effort = { ...saved, config: { ...saved.config, tiers: { ...saved.config.tiers, max: { model: 'anthropic/deep', effort: 'high' as const } } } }

  assert.deepEqual(tiersChange(saved, effort), { tiers: { max: { model: 'anthropic/deep', effort: 'high' } } })
  assert.deepEqual(tiersChange(saved, { ...saved, review: { reviewer: 'high', quick: 'mid' } }), { review: { reviewer: 'high' } })
  assert.equal(tiersChange(saved, { config: structuredClone(saved.config), review: { ...saved.review } }), null)
  assert.equal(tiersChange(saved, { ...saved, config: { ...saved.config, lead: { model: 'openai/quick', effort: 'low' } } }), null, 'the lead goes through models.select')
})

test('a tier shows its own setting, the lead it follows, or the checks it follows', () => {
  const view = fromHost(HOST, SHOWN)
  const draft = { ...view, config: { ...view.config, lead: { model: 'openai/next', effort: 'high' as const } } }

  assert.deepEqual(shownTier(draft, 'high'), { model: 'anthropic/deep', effort: 'high', follows: null })
  assert.deepEqual(shownTier(draft, 'mid'), { model: 'openai/next', effort: 'high', follows: 'main' }, 'it follows the lead in the draft')
  assert.deepEqual(shownTier(draft, 'fast'), { model: 'openai/quick', effort: 'low', follows: 'background' })
  assert.deepEqual(shownTier({ ...draft, checks: null }, 'fast'), { model: null, effort: null, follows: 'background' }, 'checks hobkin has not named')
})

test('a tier that takes a model of its own starts from what it runs with, or from the lead when that is not known', () => {
  const lead = { model: 'openai/steady', effort: 'medium' as const }

  assert.deepEqual(ownSetting({ model: 'openai/quick', effort: 'low', follows: 'background' }, lead), { model: 'openai/quick', effort: 'low' })
  assert.deepEqual(ownSetting({ model: null, effort: 'low', follows: 'background' }, lead), lead)
  assert.deepEqual(ownSetting({ model: null, effort: null, follows: 'background' }, lead), lead)
})

test('a model is named by Pi, then by its id, and no model is the default or the checks model not named yet', () => {
  const models: ModelChoice[] = [{ id: 'openai/quick', name: 'Quick', provider: 'OpenAI', efforts: ['low'] }]

  assert.equal(modelName({ model: 'openai/quick', effort: 'low', follows: null }, models), 'Quick')
  assert.equal(modelName({ model: 'openai/gone', effort: 'low', follows: null }, models), 'openai/gone')
  assert.equal(modelName({ model: null, effort: 'low', follows: 'background' }, models), "Pi's default")
  assert.equal(modelName({ model: null, effort: null, follows: 'background' }, models), 'The checks model')
})

test('a tier that follows says whose model it follows', () => {
  assert.deepEqual(followsWords('main'), { follows: 'Follows hobkin', follow: 'Follow hobkin' })
  assert.deepEqual(followsWords('background'), { follows: 'Follows checks', follow: 'Follow checks' })
})

test('tiers the window saved before review roles get the default roles, and a value that is not tiers is dropped', () => {
  const config = { lead: { model: 'openai/steady', effort: 'medium' }, tiers: { fast: null, mid: null, high: null, max: null } }

  assert.deepEqual(migrateSavedTiers({ config }, SHOWN.config), { config, review: DEFAULT_REVIEW_TIERS })
  assert.deepEqual(migrateSavedTiers({ config: 'broken' }, SHOWN.config), { config: SHOWN.config, review: DEFAULT_REVIEW_TIERS })
  assert.deepEqual(migrateSavedTiers(null, SHOWN.config), { config: SHOWN.config, review: DEFAULT_REVIEW_TIERS })
})
