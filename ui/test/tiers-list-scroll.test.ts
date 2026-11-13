import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scrollToShow } from '../src/features/tiers/list-scroll.ts'

// A list 300 tall, rows 60 tall. Positions are the list's own, from the start of its content.
const view = (top: number) => ({ top, height: 300 })
const row = (index: number) => ({ top: index * 60, height: 60 })

test('a row already in full view leaves the list where it is', () => {
  assert.equal(scrollToShow(row(2), view(0)), 0)
  assert.equal(scrollToShow(row(4), view(0)), 0, 'its bottom on the edge is in view')
  assert.equal(scrollToShow(row(5), view(120)), 120)
})

test('a row below the view brings its bottom to the bottom edge, as little as that takes', () => {
  // The last of 44 models, chosen before, as the list opens at the top.
  assert.equal(scrollToShow(row(43), view(0)), 44 * 60 - 300)
  assert.equal(scrollToShow(row(5), view(0)), 60, 'one row down')
})

test('a row above the view brings its top to the top edge', () => {
  assert.equal(scrollToShow(row(1), view(240)), 60)
  assert.equal(scrollToShow(row(0), view(30)), 0)
})

test('a row taller than the view shows its top', () => {
  assert.equal(scrollToShow({ top: 600, height: 400 }, view(0)), 600)
  assert.equal(scrollToShow({ top: 600, height: 400 }, view(900)), 600)
})
