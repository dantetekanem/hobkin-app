import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChangeScores } from '#shared/protocol/work.ts'
import { scoresView, scoresWanted } from '../src/features/review/panel/scores.ts'

const scored: ChangeScores = {
  kind: 'Bug fix',
  rate: 8.4,
  scores: [
    { name: 'coverage', score: 8, evidence: 'Tests reach it.' },
    { name: 'proof', score: 8, evidence: 'The suite passes.' },
    { name: 'deploy and data', score: 7, evidence: 'A migration runs.' },
    { name: 'visibility', score: null, evidence: '' },
    { name: 'rollback', score: 9, evidence: 'One revert.' },
  ],
  floors: [{ name: 'deploy and data', score: 7, needs: 8 }],
  stale: false,
}

test('scored, the part says the kind and rate, each score with its evidence, and each floor', () => {
  const view = scoresView(scored)
  assert.equal(view.heading, 'Bug fix, general rate 8.4')
  assert.deepEqual(view.rows[2], { name: 'deploy and data', number: '7', evidence: 'A migration runs.' })
  assert.equal(view.rows[3]!.number, '?', 'a score the review did not give')
  assert.deepEqual(view.floors, ['Held whatever the rate: deploy and data is 7, under the 8 it needs.'])
  assert.equal(view.older, null)
})

test('scores for an older commit say so', () => {
  assert.equal(scoresView({ ...scored, stale: true, floors: [] }).older, 'Scored on an older commit, not this one.')
})

test('with no scores, one line stands in for them', () => {
  const view = scoresView(null)
  assert.equal(view.heading, null)
  assert.deepEqual(view.rows, [])
  assert.ok(view.none)
})

test('the part is there for every finished change and no pull request', () => {
  assert.equal(scoresWanted('change:hobkin:7d02c9'), true)
  assert.equal(scoresWanted('pr:acme/shop/482'), false)
  assert.equal(scoresWanted('sample'), false)
})
