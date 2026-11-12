import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkerTier, reviewTier } from '../src/review/agent.ts'
import { temporaryDirectory } from './support.ts'

const home = (t: Parameters<typeof temporaryDirectory>[0], config: unknown) => {
  const root = temporaryDirectory(t)
  writeFileSync(join(root, 'config.json'), JSON.stringify(config))
  return root
}

test('a review is built on the mid tier with high thinking, whatever effort the tier names', (t) => {
  const root = home(t, { tiers: { mid: { model: 'anthropic/claude-sonnet-5-5', effort: 'low' }, high: { model: 'anthropic/claude-opus-5-5', effort: 'xhigh' } } })
  assert.deepEqual(reviewTier(root), { tier: 'mid', model: 'anthropic/claude-sonnet-5-5', effort: 'high' })
})

test('without a mid tier the review takes the closest tier that is set: high, then fast, then max, then the main chat', (t) => {
  assert.deepEqual(reviewTier(home(t, { tiers: { fast: { model: 'p/fast' }, high: { model: 'p/high' }, max: { model: 'p/max' } } })), { tier: 'high', model: 'p/high', effort: 'high' })
  assert.deepEqual(reviewTier(home(t, { tiers: { fast: { model: 'p/fast' }, max: { model: 'p/max' } } })), { tier: 'fast', model: 'p/fast', effort: 'high' })
  assert.deepEqual(reviewTier(home(t, { tiers: { max: { model: 'p/max' } } })), { tier: 'max', model: 'p/max', effort: 'high' })
  assert.deepEqual(reviewTier(home(t, { main: { model: 'p/main', effort: 'medium' } })), { tier: 'main', model: 'p/main', effort: 'high' })
  assert.equal(reviewTier(home(t, {})), null)
})

test('the blind check runs on the cheapest tier that is set, at its own thinking or low', (t) => {
  assert.deepEqual(checkerTier(home(t, { tiers: { fast: { model: 'p/fast', effort: 'minimal' }, mid: { model: 'p/mid' } } })), { tier: 'fast', model: 'p/fast', effort: 'minimal' })
  assert.deepEqual(checkerTier(home(t, { tiers: { mid: { model: 'p/mid' }, high: { model: 'p/high' } } })), { tier: 'mid', model: 'p/mid', effort: 'low' })
  assert.deepEqual(checkerTier(home(t, { main: { model: 'p/main', effort: 'xhigh' } })), { tier: 'main', model: 'p/main', effort: 'low' })
  assert.equal(checkerTier(home(t, {})), null)
})
