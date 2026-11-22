import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NO_DATA, type Tile } from '../src/features/numbers/format.ts'
import { sampleMetrics } from '../src/features/numbers/sample-metrics.ts'
import { SAMPLE_REVIEW_LIST } from '../src/features/work/sample-reviews.ts'
import { sampleWork } from '../src/features/work/sample.ts'
import { reviewTallyOf, tileOpens, tilesInputOf, tilesOf, waitingNow, workNowOf } from '../src/features/work/work-tiles.ts'

const TODAY = new Date(2026, 10, 21, 15, 30)
const NOW = TODAY.getTime()
const byKey = (tiles: readonly Tile[]) => Object.fromEntries(tiles.map((tile) => [tile.key, tile]))

test("the six tiles read what waits, the AI reviews and today's tokens from Work, and the rest from the numbers", () => {
  const work = sampleWork(NOW)
  const tiles = tilesOf(tilesInputOf(workNowOf(work), { running: 2, ready: 4, failed: 1 }, sampleMetrics(30, TODAY)), 'sample')
  assert.deepEqual(
    tiles.map((tile) => tile.key),
    ['waiting', 'merged', 'first-pass', 'by-itself', 'ai-reviews', 'tokens'],
  )
  const tile = byKey(tiles)
  // Every finished change waits for the user's yes or no, whatever its group: 3 ready, 1 to refresh, 2 that need them, 1 left a note.
  assert.equal(waitingNow(work), 7)
  assert.equal(tile.waiting!.figure, '7')
  assert.deepEqual([tile.merged!.figure, tile.merged!.context], ['7', '4 by itself'])
  assert.deepEqual([tile['ai-reviews']!.figure, tile['ai-reviews']!.after, tile['ai-reviews']!.context], ['2', 'running', '4 ready · 1 failed'])
  assert.deepEqual([tile.tokens!.figure, tile.tokens!.after], ['38M', 'of 100M'])
  assert.notEqual(tile['first-pass']!.figure, NO_DATA)
  for (const one of tiles) assert.equal(one.series.length, 30, one.key)
})

test('with a host older than the numbers, the tiles keep their boxes and say so, and what Work knows still shows', () => {
  const tiles = tilesOf(tilesInputOf(workNowOf(sampleWork(NOW)), { running: 0, ready: 1, failed: 0 }, null), 'older-host')
  const tile = byKey(tiles)
  assert.equal(tiles.length, 6)
  for (const key of ['merged', 'first-pass', 'by-itself'] as const) {
    assert.equal(tile[key]!.figure, NO_DATA, key)
    assert.equal(tile[key]!.context, 'this host sends none yet', key)
  }
  assert.equal(tile.waiting!.figure, '7')
  assert.equal(tile['ai-reviews']!.figure, '0')
  assert.equal(tile.tokens!.figure, '38M')

  const failed = byKey(tilesOf(tilesInputOf(workNowOf(sampleWork(NOW)), null, null), 'failed'))
  assert.equal(failed.merged!.context, 'could not be read')
})

test('before the AI reviews list first answers, its tile reads no data yet, not none running', () => {
  assert.equal(reviewTallyOf(null), null)
  assert.equal(byKey(tilesOf(tilesInputOf(workNowOf(sampleWork(NOW)), reviewTallyOf(null), null), 'sample'))['ai-reviews']!.figure, NO_DATA)
  const tally = reviewTallyOf(SAMPLE_REVIEW_LIST)!
  assert.ok(tally.running + tally.ready + tally.failed > 0)
})

test('a tile opens the Numbers tab at the chart it stands for', () => {
  assert.deepEqual(tileOpens('waiting'), { tab: 'numbers', at: 'waiting' })
  assert.deepEqual(tileOpens('merged'), { tab: 'numbers', at: 'merged' })
  assert.deepEqual(tileOpens('by-itself'), { tab: 'numbers', at: 'merged' })
  assert.deepEqual(tileOpens('first-pass'), { tab: 'numbers', at: 'first-pass' })
  assert.deepEqual(tileOpens('ai-reviews'), { tab: 'numbers', at: 'ai-reviews' })
  assert.deepEqual(tileOpens('tokens'), { tab: 'numbers', at: 'tokens' })
})
