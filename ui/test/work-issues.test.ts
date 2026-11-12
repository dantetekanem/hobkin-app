import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commandFor } from '../src/features/work/actions.ts'
import { applySample } from '../src/features/work/sample-actions.ts'
import { sampleWork } from '../src/features/work/sample.ts'

test("Add to queue is hobkin's own issue action, by repository and number, and Pick up issues is one of a project's settings", () => {
  assert.deepEqual(commandFor({ do: 'issue', repo: 'hobkin-sample/storefront', number: 468 }), { name: 'work.issue', args: { repo: 'hobkin-sample/storefront', number: 468 } })
  assert.deepEqual(commandFor({ do: 'issues', slug: 'storefront', issues: 'labeled' }), { name: 'work.project', args: { slug: 'storefront', issues: 'labeled' } })
})

test('with no host, Add to queue says it is sample data and adds nothing, and Pick up issues changes only its own sample project', () => {
  const work = sampleWork()

  const added = applySample(work, { do: 'issue', repo: 'hobkin-sample/storefront', number: 468 })
  assert.ok('refused' in added)
  assert.match(added.refused, /^This is sample data, so nothing was added\./)

  const set = applySample(work, { do: 'issues', slug: 'docs-site', issues: 'all' })
  assert.ok('state' in set)
  const settings = (state: typeof work) => state.projects.map(({ slug, issues }) => [slug, issues ?? 'off'])
  assert.deepEqual(settings(set.state), settings(work).map(([slug, issues]) => [slug, slug === 'docs-site' ? 'all' : issues]))
})
