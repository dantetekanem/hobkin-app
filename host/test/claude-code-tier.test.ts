import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { workTier } from '../src/claude-code/tier.ts'
import { temporaryDirectory } from './support.ts'

test("a Work run's tier is the one its project's level gives it", async (t) => {
  // hobkin's own work store, in a home of the test's own.
  const store = await import('hobkin/src/cli/work/store.mjs')
  const root = join(temporaryDirectory(t), 'home')
  const folder = join(temporaryDirectory(t), 'shop')
  mkdirSync(folder, { recursive: true })
  const { slug } = store.proposeProject(root, { name: 'Shop', path: folder, level: 'important' })
  store.chooseProject(root, slug, 'important')
  const plain = store.fileItem(root, slug, { key: 'fix-login', kind: 'fix', title: 'Fix the login', brief: 'It loops.' })
  const made = store.fileItem(root, slug, { key: 'fix-data', kind: 'fix', title: 'Fix the data', brief: 'It is lost.' })
  store.updateItem(root, slug, made.id, { max: true })

  const run = (lane: string, extra: Record<string, unknown> = {}, title = 'Shop: bugs') => ({ scheduleId: `work.${slug}.${lane}`, title, work: { slug, lane, ...extra } })
  // An important project looks on mid and does on high, as hobkin's levels say.
  assert.equal(workTier(store, root, run('look')), 'mid')
  assert.equal(workTier(store, root, run('do', { item: plain.id })), 'high')
  // An item made max runs on max, and so does the state-machines look, whatever the project's level.
  assert.equal(workTier(store, root, run('do', { item: made.id })), 'max')
  assert.equal(workTier(store, root, run('look', {}, 'Shop: state-machines')), 'max')

  // The level is read as it stands when the run starts.
  store.chooseProject(root, slug, 'casual')
  assert.equal(workTier(store, root, run('look')), 'fast')
  assert.equal(workTier(store, root, run('do', { item: plain.id })), 'mid')

  // Discover runs on no tier, and neither does a run whose project or work hobkin cannot name.
  assert.equal(workTier(store, root, { scheduleId: 'work.discover', title: 'Finding projects', work: { lane: 'discover' } }), null)
  assert.equal(workTier(store, root, run('look', { slug: 'gone' })), null)
  assert.equal(workTier(store, root, { scheduleId: 'daily-inbox', title: 'Inbox check' }), null)
})
