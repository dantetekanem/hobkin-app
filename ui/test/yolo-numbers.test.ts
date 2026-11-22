import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyMetricsDay, type MetricsDay } from '#shared/protocol/metrics.ts'
import type { YoloChange, YoloProject, YoloState } from '#shared/protocol/work.ts'
import { byItselfBars, gates, mergedLine, trustTiles } from '../src/features/work/yolo-page.ts'

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

const change = (item: string, rate: number | null, why: string | null = null): YoloChange => ({ item, title: item, kind: rate === null ? null : 'a bug fix', rate, why })
const project = (slug: string, changes: YoloChange[], ready = true): YoloProject => ({ slug, name: slug, ready, needs: ready ? [] : ['Tests: its PR waits for your merge.'], changes })
const state = (projects: YoloProject[], on = true): YoloState => ({ on, rate: 8, lowest: 6, highest: 10, ready: projects.filter(({ ready }) => ready).length, projects })
const WORK_LEFT = 'it still has work left: The independent review still needs to cover the committed range.'
const OPEN = { waits: null, paused: new Set<string>() }

test('the gates count the changes finished now: those rated at or above the user rate, those of them nothing holds, and why the rest wait', () => {
  const yolo = state([
    project('shop', [change('s1', 9.2), change('s2', 7.6, WORK_LEFT), change('s3', 7.4, WORK_LEFT), change('s4', 7.9, 'its general rate is 7.9, under 8')]),
    project('api', [change('a1', 8.8)], false),
    project('docs', [change('d1', 8.1, 'it touches a migration'), change('d2', null, 'it has no review yet')]),
    project('kit', []),
  ])
  const counted = gates(yolo, OPEN)
  assert.deepEqual(counted.steps, [
    { key: 'finished', label: 'Finished', count: 7 },
    { key: 'rated', label: 'Rated 8 or more', count: 3 },
    { key: 'free', label: 'Free to merge', count: 1 },
  ])
  assert.equal(counted.waiting, 6)
  // hobkin's own words, most first; a rate under the user's is one reason whatever the rate; a project getting ready holds what it has.
  assert.deepEqual(counted.holds, [
    { reason: 'it still has work left: The independent review still needs to cover the committed range.', count: 2 },
    { reason: 'its general rate is under 8.', count: 1 },
    { reason: 'api is getting ready.', count: 1 },
    { reason: 'it touches a migration.', count: 1 },
    { reason: 'it has no review yet.', count: 1 },
  ])
  assert.equal(counted.holds.reduce((total, { count }) => total + count, 0), counted.waiting)
  // At most three lines show: the two that hold the most, then the rest together.
  assert.deepEqual(counted.shown, [counted.holds[0], counted.holds[1], { reason: '3 other reasons', count: 3 }])
})

test('what holds every merge holds each change first: YOLO mode off, work mode waiting, or the project paused', () => {
  const yolo = state([project('shop', [change('s1', 9.2), change('s2', 7.6, WORK_LEFT)]), project('api', [change('a1', 8.4)])])
  const off = gates({ ...yolo, on: false }, OPEN)
  assert.deepEqual(off.steps.map(({ count }) => count), [3, 2, 0])
  assert.deepEqual(off.holds, [{ reason: 'YOLO mode is off.', count: 3 }])

  assert.deepEqual(gates(yolo, { waits: 'work mode is paused', paused: new Set() }).holds, [{ reason: 'work mode is paused.', count: 3 }])
  const paused = gates(yolo, { waits: null, paused: new Set(['shop']) })
  assert.deepEqual([paused.steps.at(-1)!.count, paused.holds], [1, [{ reason: 'shop is paused on Work.', count: 2 }]])
})

test('beside the gates, what merged over 30 days, by itself and on the user yes, from the numbers', () => {
  const older = { ...emptyMetricsDay('2026-10-31'), mergedByItself: 9 }
  assert.equal(mergedLine([older, ...month({ 0: { mergedByItself: 3, mergedByYou: 1 }, 6: { mergedByItself: 1, mergedByYou: 4, declined: 2 } })]), 'Over 30 days: 4 merged by itself, 5 on your yes.')
  assert.equal(mergedLine(month()), 'Over 30 days: 0 merged by itself, 0 on your yes.')
  assert.equal(mergedLine(null, 'Reading the numbers…'), 'Reading the numbers…')
})

test('with nothing finished the gates count nothing and nothing holds', () => {
  const none = gates(state([project('shop', []), { slug: 'old', name: 'old', ready: true, needs: [] }]), OPEN)
  assert.deepEqual(none.steps.map(({ count }) => count), [0, 0, 0])
  assert.deepEqual([none.waiting, none.holds, none.shown], [0, [], []])
})

test('the chart of merges by itself has one bar for each of the 30 days, and says how many in all', () => {
  const older = { ...emptyMetricsDay('2026-10-31'), mergedByItself: 9 }
  const bars = byItselfBars([older, ...month({ 0: { mergedByItself: 3, mergedByYou: 5 }, 2: { mergedByItself: 1 } })])!
  assert.equal(bars.days.length, 30)
  assert.deepEqual([bars.days[0], bars.days.at(-1)], ['2026-11-01', '2026-11-30'])
  assert.deepEqual(bars.series.map(({ key, label }) => [key, label]), [['itself', 'by itself']])
  assert.deepEqual(bars.series[0]!.values.slice(-3), [1, 0, 3])
  assert.equal(bars.figure, '4 in 30 days')
  assert.equal(byItselfBars(month())!.figure, 'none in 30 days')
  assert.equal(byItselfBars(null), null)
})
