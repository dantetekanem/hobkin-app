import assert from 'node:assert/strict'
import { test } from 'node:test'
import { modelName, placeName, reviewTitleOf } from '../src/app/trail.ts'

test('each place has a short name: the page, or what it is about', () => {
  assert.equal(placeName({ screen: 'work' }), 'Work')
  assert.equal(placeName({ screen: 'yolo' }), 'YOLO mode')
  assert.equal(placeName({ screen: 'world' }), 'World')
  assert.equal(placeName({ screen: 'actions' }), 'Action Items')
  assert.equal(placeName({ screen: 'settings' }), 'Settings')
  assert.equal(placeName({ screen: 'extensions' }), 'Pi extensions')
  assert.equal(placeName({ screen: 'project', about: 'hobkin-api' }, 'hobkin API'), 'hobkin API', "the project's name")
  assert.equal(placeName({ screen: 'project', about: 'hobkin-api' }), 'hobkin-api', 'its slug until Work names it')
  assert.equal(placeName({ screen: 'review', about: 'change:hobkin-api:7' }, 'Error tracking'), 'Review: Error tracking')
  assert.equal(placeName({ screen: 'review', about: 'change:hobkin-api:7' }), 'Review')
  assert.equal(placeName({ screen: 'proof', about: 'run-1' }, 'FinishedChangeReview'), 'Proof: FinishedChangeReview')
  assert.equal(placeName({ screen: 'proof' }), 'Proof run')
  assert.equal(placeName({ screen: 'agent', about: 'a1' }, 'Fix the login redirect'), 'Fix the login redirect', "an agent's name")
  assert.equal(placeName({ screen: 'agent', about: 'a1' }), 'Agent')
})

test("a proof is named by its model, the spec's file without its folder", () => {
  assert.equal(modelName('_specs/tla/FinishedChangeReview.tla'), 'FinishedChangeReview')
  assert.equal(modelName('WorkItem.tla'), 'WorkItem')
  assert.equal(modelName('_specs/tla/work/Queue'), 'Queue')
})

test('a review is named by the title of its finished change or its pull request', () => {
  const changes = [{ slug: 'hobkin-api', item: '7', title: 'Error tracking' }]
  const pulls = [{ repo: 'acme/billing-api', number: 128, title: 'Fix rounding in invoice export' }]
  assert.equal(reviewTitleOf('change:hobkin-api:7', changes, pulls), 'Error tracking')
  assert.equal(reviewTitleOf('pr:acme/billing-api/128', changes, pulls), 'Fix rounding in invoice export')
  assert.equal(reviewTitleOf('https://github.com/acme/billing-api/pull/128', changes, pulls), 'Fix rounding in invoice export')
  assert.equal(reviewTitleOf('change:hobkin-api:8', changes, pulls), undefined, 'one Work does not know')
  assert.equal(reviewTitleOf('sample', changes, pulls), undefined)
})
