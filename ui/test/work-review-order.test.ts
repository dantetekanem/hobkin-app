import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FinishedChange, FinishedGroup, WorkProject } from '#shared/protocol/work.ts'
import type { ReviewListItem } from '#shared/review/status.ts'
import { prioritiesOfWork, readReviewOrder } from '../src/features/work/review-order.ts'

const review = (id: string): ReviewListItem => ({ id, kind: id.startsWith('pr:') ? 'pull' : 'change', title: id, project: 'storefront', head: null, state: 'ready', phase: null, error: null, updatedAt: '2026-11-23T12:00:00.000Z' })
const project = (slug: string, priority: WorkProject['priority']) => ({ slug, priority }) as WorkProject
const change = (key: string, grade: FinishedChange['grade']) => ({ key, grade }) as FinishedChange
const group = (changes: FinishedChange[]) => ({ changes }) as FinishedGroup

test("a review's priority is its finished change's own grade, else its project's priority, and a pull request has none", () => {
  const priorityOf = prioritiesOfWork({
    projects: [project('storefront', 'P1'), project('docs-site', 'P3')],
    finished: [group([change('storefront:graded', 'P0')]), group([change('storefront:ungraded', null)])],
  })

  assert.equal(priorityOf(review('change:storefront:graded')), 'P0')
  assert.equal(priorityOf(review('change:storefront:ungraded')), 'P1', "a change with no grade goes by its project's priority")
  assert.equal(priorityOf(review('change:docs-site:gone-from-finished')), 'P3', 'and so does one the finished list no longer holds')
  assert.equal(priorityOf(review('change:unknown-project:a1')), null)
  assert.equal(priorityOf(review('pr:acme/web/12')), null)
})

test('before the work is known, no review has a priority', () => {
  const priorityOf = prioritiesOfWork(null)

  assert.equal(priorityOf(review('change:storefront:graded')), null)
})

test('the order the user picked reads back as it was kept, and anything else reads as easiest first', () => {
  assert.equal(readReviewOrder('priority'), 'priority')
  assert.equal(readReviewOrder('oldest'), 'oldest')
  assert.equal(readReviewOrder('smallest'), 'smallest')
  assert.equal(readReviewOrder('newest'), 'newest')
  assert.equal(readReviewOrder(null), 'easiest')
  assert.equal(readReviewOrder('by size'), 'easiest')
})
