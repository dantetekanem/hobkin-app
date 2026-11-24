import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commandFor } from '../src/features/work/actions.ts'
import { applySample } from '../src/features/work/sample-actions.ts'
import { sampleWork } from '../src/features/work/sample.ts'

test("Pick up issues is one of a project's settings", () => {
  assert.deepEqual(commandFor({ do: 'issues', slug: 'storefront', issues: 'labeled' }), { name: 'work.project', args: { slug: 'storefront', issues: 'labeled' } })
})

test('with no host, Pick up issues changes only its own sample project', () => {
  const work = sampleWork()
  const set = applySample(work, { do: 'issues', slug: 'docs-site', issues: 'all' })
  assert.ok('state' in set)
  const settings = (state: typeof work) => state.projects.map(({ slug, issues }) => [slug, issues ?? 'off'])
  assert.deepEqual(settings(set.state), settings(work).map(([slug, issues]) => [slug, slug === 'docs-site' ? 'all' : issues]))
})
