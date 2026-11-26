import assert from 'node:assert/strict'
import { test } from 'node:test'
import { KEPT_LISTS, keepList, keepRect, keptList, keptRect, openingOf, placeAt, windowedSteps } from '../src/features/agent-activity/windowed-place.ts'

const sizes = (entries: [string, number][]) => new Map(entries)

test('a list left following its newest row opens following it again', () => {
  keepList('pinned list', { place: { pinned: true }, sizes: sizes([['a', 40]]), width: 800 })
  const kept = keptList('pinned list')
  assert.deepEqual(kept?.place, { pinned: true })
  assert.deepEqual(openingOf(kept?.place, () => 3), { pinned: true })
})

test('a list left scrolled up opens at the row it was read from, as far into it as it was', () => {
  const place = placeAt({ key: 'step 7', start: 1200 }, 1230, false)
  assert.deepEqual(place, { pinned: false, key: 'step 7', offset: 30 })
  keepList('read list', { place, sizes: sizes([]), width: 800 })
  const index = new Map([['step 6', 6], ['step 7', 7]])
  assert.deepEqual(openingOf(keptList('read list')?.place, (key) => index.get(key) ?? -1), { pinned: false, index: 7, offset: 30 })
})

test('a list whose row it was read from is gone opens at its newest, following it', () => {
  const place = placeAt({ key: 'gone', start: 0 }, 10, false)
  assert.deepEqual(openingOf(place, () => -1), { pinned: true })
})

test('a list never left before, or left following, opens at its newest', () => {
  assert.deepEqual(openingOf(undefined, () => 0), { pinned: true })
  assert.deepEqual(placeAt({ key: 'a', start: 0 }, 500, true), { pinned: true })
  assert.deepEqual(placeAt(undefined, 500, false), { pinned: true })
})

test('each list is kept by its own name with its rows heights and the width they were drawn at', () => {
  keepList('one', { place: { pinned: true }, sizes: sizes([['a', 40], ['b', 120]]), width: 640 })
  keepList('two', { place: { pinned: true }, sizes: sizes([['a', 90]]), width: 900 })
  assert.equal(keptList('one')?.sizes.get('b'), 120)
  assert.equal(keptList('one')?.width, 640)
  assert.equal(keptList('two')?.sizes.get('a'), 90)
  assert.equal(keptList('never'), undefined)
})

test('only the lists left most recently are kept: the one left longest ago goes first', () => {
  for (let index = 0; index <= KEPT_LISTS; index++) keepList(`many ${index}`, { place: { pinned: true }, sizes: sizes([]), width: 1 })
  assert.equal(keptList('many 0'), undefined)
  assert.notEqual(keptList('many 1'), undefined)
  // Opening a list again makes it the newest kept.
  keptList('many 1')
  keepList('many extra', { place: { pinned: true }, sizes: sizes([]), width: 1 })
  assert.notEqual(keptList('many 1'), undefined)
  assert.equal(keptList('many 2'), undefined)
})

test('the size of the box the lists scroll in is kept for the next list to open with', () => {
  keepRect({ width: 700, height: 520 })
  assert.deepEqual(keptRect(), { width: 700, height: 520 })
})

test('what is kept survives the module being loaded again, as a hot update does', async () => {
  keepList('hot', { place: { pinned: false, key: 'x', offset: 4 }, sizes: sizes([['x', 50]]), width: 300 })
  const again = (await import(`../src/features/agent-activity/windowed-place.ts?again=${Date.now()}`)) as typeof import('../src/features/agent-activity/windowed-place.ts')
  assert.deepEqual(again.keptList('hot')?.place, { pinned: false, key: 'x', offset: 4 })
})

test('the windowed transcript is off unless the switch is set', () => {
  const storage = (value: string | null) => ({ getItem: () => value })
  assert.equal(windowedSteps(storage(null)), false)
  assert.equal(windowedSteps(storage('0')), false)
  assert.equal(windowedSteps(storage('off')), false)
  assert.equal(windowedSteps(storage('1')), false)
  assert.equal(windowedSteps(storage('true')), false)
  assert.equal(windowedSteps(storage('on')), true)
  assert.equal(windowedSteps(undefined), false)
  assert.equal(
    windowedSteps({
      getItem: () => {
        throw new Error('blocked')
      },
    }),
    false,
  )
})
