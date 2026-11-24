import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NO_DATA, type Tile } from '../src/features/numbers/format.ts'
import { sampleMetrics } from '../src/features/numbers/sample-metrics.ts'
import { SAMPLE_REVIEW_LIST } from '../src/features/work/sample-reviews.ts'
import { sampleWork } from '../src/features/work/sample.ts'
import { oldestAtOf, reviewTallyOf, tileOpens, tilesInputOf, tilesOf, waitingNow, workNowOf } from '../src/features/work/work-tiles.ts'

const TODAY = new Date(2026, 10, 21, 15, 30)
const NOW = TODAY.getTime()
const byKey = (tiles: readonly Tile[]) => Object.fromEntries(tiles.map((tile) => [tile.key, tile]))

test("the six tiles read what waits, the AI reviews and today's tokens from Work, and the rest from the numbers", () => {
  const work = sampleWork(NOW)
  const now = workNowOf(work)
  const reviews = { running: 2, ready: 4, failed: 1 }

  const tiles = tilesOf(tilesInputOf(now, reviews, sampleMetrics(30, TODAY), NOW), 'sample', now.needsYou)

  assert.deepEqual(
    tiles.map((tile) => tile.key),
    ['waiting', 'merged', 'first-pass', 'by-itself', 'ai-reviews', 'tokens'],
  )
  const tile = byKey(tiles)
  // Every finished change waits for the user's yes or no, whatever its group: 8 ready (a stack of five among them), 3 to refresh (a stack of two among them), 2 that need them, 6 left a note.
  assert.equal(waitingNow(work), 19)
  assert.equal(tile.waiting!.figure, '19')
  // The sample's oldest finished change was last written 26 hours ago.
  assert.equal(tile.waiting!.context, 'oldest 26 h')
  assert.deepEqual([tile.merged!.figure, tile.merged!.context], ['7', '4 by itself'])
  assert.deepEqual([tile['ai-reviews']!.figure, tile['ai-reviews']!.after, tile['ai-reviews']!.context], ['2', 'running', '4 ready · 1 failed'])
  assert.deepEqual([tile.tokens!.figure, tile.tokens!.after], ['38M', 'of 100M'])
  assert.notEqual(tile['first-pass']!.figure, NO_DATA)
  for (const one of tiles) assert.equal(one.series.length, 30, one.key)
})

test('the waiting tile says how long the oldest has waited when every change says when hobkin last wrote it, and how many need the user when one does not', () => {
  const work = sampleWork(NOW)
  assert.equal(oldestAtOf(work), NOW - 26 * 3_600_000)
  const waitingTile = (state: typeof work) => {
    const now = workNowOf(state)
    return tilesOf(tilesInputOf(now, null, null, NOW), 'sample', now.needsYou)[0]!
  }
  assert.equal(waitingTile(work).context, 'oldest 26 h')

  // One change with no time, as from a host older than it: how old the oldest is is not known.
  const [first, ...rest] = work.finished
  const { at: _gone, ...untimed } = first!.changes[0]!
  const partly = { ...work, finished: [{ ...first!, changes: [untimed, ...first!.changes.slice(1)] }, ...rest] }
  assert.equal(oldestAtOf(partly), null)
  assert.equal(waitingTile(partly).context, '8 need you first')
  assert.equal(oldestAtOf({ ...work, finished: [] }), null)
})

test('with a host older than the numbers, the tiles keep their boxes and say so, and what Work knows still shows', () => {
  const tiles = tilesOf(tilesInputOf(workNowOf(sampleWork(NOW)), { running: 0, ready: 1, failed: 0 }, null), 'older-host')
  const tile = byKey(tiles)
  assert.equal(tiles.length, 6)
  for (const key of ['merged', 'first-pass', 'by-itself'] as const) {
    assert.equal(tile[key]!.figure, NO_DATA, key)
    assert.equal(tile[key]!.context, 'this host sends none yet', key)
  }
  assert.equal(tile.waiting!.figure, '19')
  assert.equal(tile['ai-reviews']!.figure, '0')
  assert.equal(tile.tokens!.figure, '38M')

  const failed = byKey(tilesOf(tilesInputOf(workNowOf(sampleWork(NOW)), null, null), 'failed'))
  assert.equal(failed.merged!.context, 'could not be read')
})

test('before the AI reviews list first answers, its tile reads no data yet, not none running', () => {
  assert.equal(reviewTallyOf(null), null)
  const beforeTheList = byKey(tilesOf(tilesInputOf(workNowOf(sampleWork(NOW)), reviewTallyOf(null), null), 'sample'))
  assert.equal(beforeTheList['ai-reviews']!.figure, NO_DATA)

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
