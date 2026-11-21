import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyMetricsDay, ratesOf, type MetricsDay } from '../protocol/metrics.ts'

const day = (over: Partial<MetricsDay>): MetricsDay => ({ ...emptyMetricsDay('2026-11-21'), ...over })

test('the rates of a run of days are shares of what happened in all of them', () => {
  const rates = ratesOf([
    day({ mergedByItself: 3, mergedByYou: 1, declined: 1, firstPass: 4, sentBack: 2, reviewsSafe: 6, reviewsRisky: 2, regressed: 1, tokens: 8_000_000 }),
    day({ mergedByYou: 4, firstPass: 3, sentBack: 2, reviewsSafe: 2, tokens: 4_000_000 }),
  ])
  assert.deepEqual(rates, {
    merged: 8,
    byItselfShare: 3 / 8,
    firstPassRate: 7 / 9,
    sentBackPerMerged: 4 / 8,
    riskyShare: 2 / 10,
    regressedShare: 1 / 3,
    tokensPerMerged: 1_500_000,
  })
})

test('a rate with nothing under it is null, never 0 or 100 percent of nothing', () => {
  assert.deepEqual(ratesOf([]), { merged: 0, byItselfShare: null, firstPassRate: null, sentBackPerMerged: null, riskyShare: null, regressedShare: null, tokensPerMerged: null })
  // Merged by the user alone: no share of regressions to speak of, since nothing merged by itself.
  assert.equal(ratesOf([day({ mergedByYou: 2, firstPass: 2 })]).regressedShare, null)
  assert.equal(ratesOf([day({ mergedByYou: 2, firstPass: 2 })]).byItselfShare, 0)
})
