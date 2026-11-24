import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scoresWanted } from '../src/features/review/panel/scores.ts'

test("hobkin's own scored run has its part on every finished change and on no pull request", () => {
  assert.equal(scoresWanted('change:hobkin:7d02c9'), true)
  assert.equal(scoresWanted('pr:acme/shop/482'), false)
  assert.equal(scoresWanted('sample'), false)
})
