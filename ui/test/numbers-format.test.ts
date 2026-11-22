import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyMetricsDay, type MetricsDay } from '#shared/protocol/metrics.ts'
import { countWords, dayWords, foldDays, lastDays, localDay, NO_DATA, shareWords, shortDay, spanWords, sumDays, tokenWords, weeksOf, workTiles } from '../src/features/numbers/format.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** Consecutive days ending on `last`, each with what `fill` gives it. */
function daysTo(last: string, count: number, fill: (index: number) => Partial<MetricsDay> = () => ({})): MetricsDay[] {
  const [year, month, date] = last.split('-').map(Number) as [number, number, number]
  return Array.from({ length: count }, (_, index) => ({ ...emptyMetricsDay(localDay(new Date(year, month - 1, date - (count - 1 - index)))), ...fill(index) }))
}

test('a share reads as a whole percent, and a share of nothing reads "no data yet"', () => {
  assert.equal(shareWords(0.82), '82%')
  assert.equal(shareWords(0), '0%')
  assert.equal(shareWords(1), '100%')
  assert.equal(shareWords(null), NO_DATA)
  assert.equal(NO_DATA, 'no data yet')
})

test('a share is never rounded to none or all when it is neither', () => {
  assert.equal(shareWords(0.003), '<1%')
  assert.equal(shareWords(0.997), '>99%')
})

test('a span reads in minutes under an hour, in hours under two days, then in days', () => {
  assert.equal(spanWords(null), NO_DATA)
  assert.equal(spanWords(20_000), 'under 1 min')
  assert.equal(spanWords(42 * MINUTE), '42 min')
  assert.equal(spanWords(59.7 * MINUTE), '1 h')
  assert.equal(spanWords(3 * HOUR), '3 h')
  assert.equal(spanWords(1.5 * HOUR), '1.5 h')
  assert.equal(spanWords(26.4 * HOUR), '26 h')
  assert.equal(spanWords(24 * 3 * HOUR), '3 days')
})

test('tokens read short: 38M, 950K, 1.2M, 1.1B', () => {
  assert.equal(tokenWords(38_000_000), '38M')
  assert.equal(tokenWords(950_000), '950K')
  assert.equal(tokenWords(1_240_000), '1.2M')
  assert.equal(tokenWords(999_960), '1M')
  assert.equal(tokenWords(1_100_000_000), '1.1B')
  assert.equal(tokenWords(640), '640')
})

test('a count reads in full under ten thousand and short above', () => {
  assert.equal(countWords(1284), '1,284')
  assert.equal(countWords(12_900), '13K')
  assert.equal(countWords(9_999), '9,999')
})

test('a day reads as Today, Yesterday or its date', () => {
  assert.equal(dayWords('2026-11-21', '2026-11-21'), 'Today')
  assert.equal(dayWords('2026-11-20', '2026-11-21'), 'Yesterday')
  assert.equal(dayWords('2026-11-14', '2026-11-21'), 'Sat, Nov 14')
  assert.equal(shortDay('2026-11-14'), 'Nov 14')
})

test('the last N days are the newest ones, oldest first', () => {
  const days = daysTo('2026-11-21', 10)
  assert.deepEqual(lastDays(days, 3).map((day) => day.day), ['2026-11-19', '2026-11-20', '2026-11-21'])
  assert.equal(lastDays(days, 40).length, 10)
  assert.deepEqual(lastDays(days, 0), [])
})

test('the weekly fold counts back from the newest day, so the oldest week is the short one', () => {
  const days = daysTo('2026-11-21', 30, (index) => ({ mergedByYou: 1, firstPass: index % 2 }))
  const weeks = weeksOf(days)
  assert.deepEqual(
    weeks.map((week) => [week.from, week.to, week.days.length]),
    [
      ['2026-10-23', '2026-10-24', 2],
      ['2026-10-25', '2026-10-31', 7],
      ['2026-11-01', '2026-11-07', 7],
      ['2026-11-08', '2026-11-14', 7],
      ['2026-11-15', '2026-11-21', 7],
    ],
  )
  assert.equal(weeks.at(-1)!.total.mergedByYou, 7)
  assert.equal(weeks.reduce((total, week) => total + week.total.firstPass, 0), 15)
  assert.equal(weeks[0]!.total.day, '2026-10-23')
})

test('a fold of one day keeps each day', () => {
  const days = daysTo('2026-11-21', 7)
  assert.deepEqual(foldDays(days, 1).map((fold) => fold.from), days.map((day) => day.day))
})

test('the sum of days adds every count', () => {
  const total = sumDays(daysTo('2026-11-21', 3, () => ({ tokens: 2_000_000, reviewsRisky: 1 })))
  assert.equal(total.tokens, 6_000_000)
  assert.equal(total.reviewsRisky, 3)
  assert.equal(total.day, '2026-11-19')
})

test('the six tiles say what the sketch says from the last 30 days', () => {
  const today = 44
  const days = daysTo('2026-11-21', 45, (index) => {
    if (index === today) return { mergedByItself: 4, mergedByYou: 3, tokens: 38_000_000 }
    // The 29 days before today, the rest of the tiles' 30.
    if (index >= 15) return { mergedByYou: 1, firstPass: 1 }
    // Older than 30 days, so no tile counts them.
    return { mergedByYou: 5 }
  })

  const tiles = workTiles({
    days,
    waiting: { count: 5, oldestMs: 3 * HOUR },
    reviews: { running: 2, ready: 4, failed: 1 },
    tokens: { today: 38_000_000, limit: 100_000_000 },
  })

  assert.deepEqual(
    tiles.map(({ key, label, figure, after, context }) => [key, label, figure, after ?? null, context]),
    [
      ['waiting', 'Waiting for you', '5', null, 'oldest 3 h'],
      ['merged', 'Merged today', '7', null, '4 by itself'],
      ['first-pass', 'First pass', '81%', null, 'of 36 decided'],
      ['by-itself', 'By itself', '11%', null, 'of 36 merged'],
      ['ai-reviews', 'AI reviews', '2', 'running', '4 ready · 1 failed'],
      ['tokens', 'Tokens today', '38M', 'of 100M', 'resets at midnight'],
    ],
  )
  for (const tile of tiles) {
    assert.equal(tile.series.length, 30, tile.key)
    assert.ok(tile.counts.length > 20, tile.key)
  }
})

test('a tile counts in full with thousands marked', () => {
  const [waiting] = workTiles({ days: null, waiting: { count: 1284, oldestMs: null }, reviews: null, tokens: null })
  assert.equal(waiting!.figure, '1,284')
})

test('a tile with nothing under it reads "no data yet", never 0% or 100%', () => {
  const tiles = workTiles({ days: daysTo('2026-11-21', 30), waiting: { count: 0, oldestMs: null }, reviews: null, tokens: null })
  const byKey = Object.fromEntries(tiles.map((tile) => [tile.key, tile]))
  assert.equal(byKey['first-pass']!.figure, NO_DATA)
  assert.equal(byKey['first-pass']!.context, 'nothing decided yet')
  assert.equal(byKey['by-itself']!.figure, NO_DATA)
  assert.equal(byKey['by-itself']!.context, 'nothing merged yet')
  assert.equal(byKey['merged']!.figure, '0')
  assert.equal(byKey['merged']!.context, 'nothing yet today')
  assert.equal(byKey['waiting']!.context, 'none waiting')
  assert.equal(byKey['ai-reviews']!.figure, NO_DATA)
  assert.equal(byKey['tokens']!.figure, '0')
  assert.ok(byKey['first-pass']!.series.every((value) => value === null))
})

test('the tiles read "no data yet" while the numbers are not known', () => {
  const tiles = workTiles({ days: null, waiting: null, reviews: null, tokens: null })
  for (const tile of tiles) {
    assert.equal(tile.figure, NO_DATA, tile.key)
    assert.equal(tile.series.length, 30, tile.key)
  }
})
