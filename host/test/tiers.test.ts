import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { applyHostTiers, readHostTiers } from '../src/tiers.ts'
import { temporaryDirectory } from './support.ts'

/** A home as hobkin makes one, with a chat model and a checks model. */
async function home(t: Parameters<typeof temporaryDirectory>[0]): Promise<string> {
  const root = temporaryDirectory(t)
  const { initialize } = await import('hobkin/src/cli/config.mjs')
  initialize(root, { cwd: root })
  const file = join(root, 'config.json')
  const config = JSON.parse(readFileSync(file, 'utf8'))
  writeFileSync(file, JSON.stringify({ ...config, main: { ...config.main, model: 'fake/chat', effort: 'high' }, background: { harness: 'pi', model: 'fake/checks', effort: 'low' } }))
  return root
}

/** Pi's catalog with one more model in it, which offers every thinking level but xhigh. */
const catalog = {
  getModel: (provider: string, id: string) => (provider === 'fake' && id === 'strong' ? { provider, id, reasoning: true } : undefined),
}

test("the window reads hobkin's own tiers: the chat's model, each tier as it runs now, and the review's two tiers", async (t) => {
  const root = await home(t)
  assert.deepEqual(await readHostTiers(root), {
    lead: { model: 'fake/chat', effort: 'high' },
    tiers: {
      fast: { model: 'fake/checks', effort: 'low', follows: 'background' },
      mid: { model: 'fake/chat', effort: 'high', follows: 'main' },
      high: { model: 'fake/chat', effort: 'high', follows: 'main' },
      max: { model: 'fake/chat', effort: 'high', follows: 'main' },
    },
    review: { reviewer: 'high', quick: 'fast' },
  })
})

test('a change is saved by hobkin in its config.json and read back, and a refused one saves nothing', async (t) => {
  const root = await home(t)
  const saved = await applyHostTiers(root, { tiers: { high: { model: 'fake/strong', effort: 'high' } }, review: { reviewer: 'max' } }, catalog)
  assert.deepEqual(saved.tiers.high, { model: 'fake/strong', effort: 'high', follows: null })
  assert.deepEqual(saved.review, { reviewer: 'max', quick: 'fast' })
  assert.deepEqual(saved, await readHostTiers(root))
  const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'))
  assert.deepEqual([config.tiers, config.review], [{ high: { model: 'fake/strong', effort: 'high' } }, { reviewer: 'max', quick: 'fast' }])

  const before = readFileSync(join(root, 'config.json'), 'utf8')
  await assert.rejects(applyHostTiers(root, { tiers: { mid: { model: 'fake/missing', effort: 'low' } }, review: { quick: 'mid' } }, catalog), /not installed/)
  assert.equal(readFileSync(join(root, 'config.json'), 'utf8'), before)
  // Following again: the tier has no setting of its own any more.
  assert.deepEqual((await applyHostTiers(root, { tiers: { high: null } }, catalog)).tiers.high, { model: 'fake/chat', effort: 'high', follows: 'main' })
})
