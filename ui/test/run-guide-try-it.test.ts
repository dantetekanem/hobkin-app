import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WorkProject } from '#shared/protocol/work.ts'
import { firstStepOf, offersTryIt } from '../src/features/work/try-it.ts'

test('a change on a branch is brought in with git fetch and git switch to its branch', () => {
  assert.deepEqual(firstStepOf({ branch: 'hobkin/4c9e21-remember-the-shipping-address', pr: null }), {
    kind: 'branch',
    commands: ['git fetch', 'git switch hobkin/4c9e21-remember-the-shipping-address'],
  })
})

test('a pull request is checked out by its number, even when it also has a branch', () => {
  assert.deepEqual(firstStepOf({ branch: 'hobkin/8d2f60-fix-the-login-redirect', pr: 'https://github.com/hobkin-sample/storefront/pull/479' }), {
    kind: 'pr',
    commands: ['gh pr checkout 479'],
  })
})

test('a pull request address with no number in it is checked out by its address', () => {
  assert.deepEqual(firstStepOf({ branch: null, pr: 'https://git.invalid/review/abc' }).commands, ['gh pr checkout https://git.invalid/review/abc'])
})

test('a branch whose name the shell would read is quoted, and a change with neither has no first step', () => {
  assert.deepEqual(firstStepOf({ branch: "fix/it's-$HOME", pr: null }).commands, ['git fetch', `git switch 'fix/it'\\''s-$HOME'`])
  assert.deepEqual(firstStepOf({ branch: null, pr: null }), { kind: 'none', commands: [] })
})

const projects: Pick<WorkProject, 'slug' | 'kind'>[] = [{ slug: 'storefront', kind: 'code' }, { slug: 'billing-api' }, { slug: 'marathon-plan', kind: 'goal' }]

test('a code project\'s change offers Try it and a goal\'s does not', () => {
  assert.equal(offersTryIt({ slug: 'storefront' }, projects), true)
  // A hobkin older than goals sends no kind: the project is code.
  assert.equal(offersTryIt({ slug: 'billing-api' }, projects), true)
  assert.equal(offersTryIt({ slug: 'marathon-plan' }, projects), false)
})

test('a change of a project the window does not know yet still offers Try it', () => {
  assert.equal(offersTryIt({ slug: 'rpsleague' }, projects), true)
})
