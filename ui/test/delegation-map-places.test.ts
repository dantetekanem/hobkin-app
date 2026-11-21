import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapPlaces } from '../src/features/work/map-places.ts'

test('the map draws free workers until it has eight places, then one row of how many more', () => {
  assert.deepEqual(mapPlaces(2, 0), { free: 2, more: 0, places: 2 }, 'the default looks as it did')
  assert.deepEqual(mapPlaces(8, 3), { free: 5, more: 0, places: 8 }, 'eight looks as it did')
  assert.deepEqual(mapPlaces(9, 0), { free: 8, more: 1, places: 9 })
  assert.deepEqual(mapPlaces(100, 0), { free: 8, more: 92, places: 9 }, 'nine rows when nothing runs')
  assert.deepEqual(mapPlaces(100, 12), { free: 0, more: 88, places: 13 }, 'every running agent is drawn, and the rest is one row')
})

test('the map draws no free place past what hobkin may run, and every running agent however many', () => {
  assert.deepEqual(mapPlaces(0, 0), { free: 0, more: 0, places: 0 })
  assert.deepEqual(mapPlaces(2, 3), { free: 0, more: 0, places: 3 }, 'a start-now worker past the number')
  assert.deepEqual(mapPlaces(8, 8), { free: 0, more: 0, places: 8 })
})
