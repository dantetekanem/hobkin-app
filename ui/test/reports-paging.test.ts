import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AHEAD, PAGE, arrivesQuietly, drawnCount, needsMore, nextLimit, showing } from '../src/features/reports/paging.ts'

test('the list draws a first page, never more than there is', () => {
  assert.equal(drawnCount(PAGE, 500), PAGE)
  assert.equal(drawnCount(PAGE, 12), 12, 'a short list is drawn whole')
  assert.equal(drawnCount(PAGE, 0), 0)
})

test('more is drawn as the end of what is drawn comes near, and not before', () => {
  const drawn = PAGE
  assert.equal(needsMore(drawn - AHEAD - 1, drawn, 500), false, 'still well above the end')
  assert.equal(needsMore(drawn - AHEAD, drawn, 500), true, 'close enough to the end')
  assert.equal(needsMore(drawn - 1, drawn, 500), true, 'on the last drawn row')
  assert.equal(needsMore(drawn - 1, drawn, drawn), false, 'everything is drawn already')
  assert.equal(needsMore(-1, drawn, 500), false, 'a row that is not in the list asks for nothing')
})

test('each time it grows by one page', () => {
  assert.equal(nextLimit(PAGE), PAGE * 2)
  assert.equal(nextLimit(PAGE * 3), PAGE * 4)
})

test('a report opened past what is drawn is drawn, in whole pages', () => {
  assert.equal(showing(5, PAGE), PAGE, 'already drawn')
  assert.equal(showing(PAGE, PAGE), PAGE * 2, 'the first row of the next page')
  assert.equal(showing(PAGE * 3 + 7, PAGE), PAGE * 4)
  assert.equal(showing(-1, PAGE * 2), PAGE * 2, 'a report that is not in the list changes nothing')
})

test('rows past the first page arrive by paging, so they land without an entrance', () => {
  assert.equal(arrivesQuietly(0), false)
  assert.equal(arrivesQuietly(PAGE - 1), false)
  assert.equal(arrivesQuietly(PAGE), true)
  assert.equal(arrivesQuietly(PAGE * 5), true)
})
