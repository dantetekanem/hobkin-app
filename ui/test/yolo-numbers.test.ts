import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyMetricsDay, type MetricsDay } from '#shared/protocol/metrics.ts'
import { trustTiles } from '../src/features/work/yolo-page.ts'

/** Thirty days of nothing, ending today, with the counts given on the days named by how many days ago they were. */
function month(counts: Record<number, Partial<MetricsDay>> = {}): MetricsDay[] {
  return Array.from({ length: 30 }, (_, index) => ({ ...emptyMetricsDay(`2026-11-${String(index + 1).padStart(2, '0')}`), ...counts[29 - index] }))
}

const tile = (tiles: ReturnType<typeof trustTiles>, key: string) => tiles.find((entry) => entry.key === key)!

test("YOLO mode's trust row says over 30 days the share merged by itself, how many of those regressed, and how many were held for the user", () => {
  // A day older than the 30 counts for nothing.
  const older = { ...emptyMetricsDay('2026-10-31'), mergedByItself: 9, regressed: 2 }
  const tiles = trustTiles([older, ...month({ 0: { mergedByItself: 3, mergedByYou: 1 }, 4: { mergedByItself: 2, mergedByYou: 2, declined: 1, regressed: 1 } })])
  assert.deepEqual(
    tiles.map(({ key, label, figure, after, context }) => ({ key, label, figure, after, context })),
    [
      { key: 'by-itself', label: 'By itself', figure: '63%', after: undefined, context: '5 of 8 merges in 30 days' },
      { key: 'regressed', label: 'Regressed after deploy', figure: '1', after: 'of 5', context: 'merged by itself in 30 days' },
      { key: 'held', label: 'Held for you', figure: '4', after: undefined, context: 'decided by you in 30 days' },
    ],
  )
  // Each says in a sentence what it counts, and draws one bar a day for the 30 days.
  for (const entry of tiles) {
    assert.match(entry.counts, /30 days/)
    assert.equal(entry.series.length, 30)
  }
  assert.equal(tile(tiles, 'by-itself').series.at(-1), 0.75)
  assert.equal(tile(tiles, 'by-itself').series.at(-2), null)
  assert.equal(tile(tiles, 'by-itself').most, 1)
  assert.deepEqual(tile(tiles, 'held').series.slice(-5), [3, 0, 0, 0, 1])
})

test('a trust row says "0 of 12" when nothing regressed, and "no data yet" when nothing merged by itself', () => {
  const clean = trustTiles(month({ 2: { mergedByItself: 12 } }))
  assert.deepEqual([tile(clean, 'regressed').figure, tile(clean, 'regressed').after], ['0', 'of 12'])
  assert.equal(tile(clean, 'by-itself').figure, '100%')

  const byYou = trustTiles(month({ 1: { mergedByYou: 4 } }))
  assert.deepEqual([tile(byYou, 'by-itself').figure, tile(byYou, 'by-itself').context], ['0%', '0 of 4 merges in 30 days'])
  assert.deepEqual([tile(byYou, 'regressed').figure, tile(byYou, 'regressed').after, tile(byYou, 'regressed').context], ['no data yet', undefined, 'nothing by itself in 30 days'])

  const quiet = trustTiles(month())
  assert.deepEqual(quiet.map(({ figure }) => figure), ['no data yet', 'no data yet', '0'])
  assert.equal(tile(quiet, 'by-itself').context, 'nothing merged in 30 days')
})

test('a trust row with no numbers says "no data yet" in each tile and why on its line', () => {
  const none = trustTiles(null, 'This host sends no numbers yet.')
  assert.deepEqual(
    none.map(({ figure, context }) => [figure, context]),
    [
      ['no data yet', 'This host sends no numbers yet.'],
      ['no data yet', 'This host sends no numbers yet.'],
      ['no data yet', 'This host sends no numbers yet.'],
    ],
  )
  assert.ok(none.every(({ series }) => series.length === 30 && series.every((value) => value === null)))
})
