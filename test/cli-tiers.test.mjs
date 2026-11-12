import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewTiers, tierBinding, tierNames, validateReview, validateTiers } from '../src/cli/tiers.mjs';

const config = {
  main: { cwd: '/work', model: 'anthropic/chat', effort: 'high' },
  background: { harness: 'pi', model: 'anthropic/checks', effort: 'low' },
};

test('a tier that is set runs on its own model and effort', () => {
  const tiers = { mid: { model: 'anthropic/sonnet', effort: 'medium' }, max: { model: 'anthropic/opus', effort: 'xhigh' } };
  assert.deepEqual(tierBinding({ ...config, tiers }, 'mid'), { tier: 'mid', model: 'anthropic/sonnet', effort: 'medium', follows: null });
  assert.deepEqual(tierBinding({ ...config, tiers }, 'max'), { tier: 'max', model: 'anthropic/opus', effort: 'xhigh', follows: null });
});

test('a tier that is not set follows the checks model when it is fast, and the chat model for work that writes code', () => {
  assert.deepEqual(tierBinding(config, 'fast'), { tier: 'fast', model: 'anthropic/checks', effort: 'low', follows: 'background' });
  for (const tier of ['mid', 'high', 'max']) {
    assert.deepEqual(tierBinding({ ...config, tiers: { fast: { model: 'p/quick', effort: 'low' }, [tier]: null } }, tier), { tier, model: 'anthropic/chat', effort: 'high', follows: 'main' });
  }
});

test('a job that names no tier, or one hobkin does not have, is ordinary work: mid', () => {
  assert.equal(tierBinding(config).tier, 'mid');
  assert.equal(tierBinding(config, 'huge').tier, 'mid');
  assert.deepEqual(tierNames, ['fast', 'mid', 'high', 'max']);
});

test('tiers in the configuration are a model and an effort for each name hobkin has, and nothing else', () => {
  assert.equal(validateTiers(undefined), undefined);
  const tiers = { fast: { model: 'p/quick', effort: 'low' }, high: null };
  assert.equal(validateTiers(tiers), tiers);
  assert.throws(() => validateTiers({ huge: { model: 'p/x', effort: 'low' } }), /tier must be one of fast, mid, high, max/);
  assert.throws(() => validateTiers({ fast: { model: 'p/x', effort: 'extreme' } }), /effort/);
  assert.throws(() => validateTiers({ fast: { effort: 'low' } }), /model/);
  assert.throws(() => validateTiers([]), /tiers/);
});

test('a change review uses two tiers, the Reviewer on high and Quick on fast until the user names others', () => {
  assert.deepEqual(reviewTiers(config), { reviewer: 'high', quick: 'fast' });
  assert.deepEqual(reviewTiers({ ...config, review: { reviewer: 'max' } }), { reviewer: 'max', quick: 'fast' });
  assert.equal(validateReview(undefined), undefined);
  assert.throws(() => validateReview({ reviewer: 'huge' }), /tier must be one of/);
  assert.throws(() => validateReview({ checker: 'fast' }), /review names a tier for reviewer and quick/);
  assert.throws(() => validateReview('high'), /review names a tier for reviewer and quick/);
});
