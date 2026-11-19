import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OPEN_LINES, previewOf } from '../src/features/agent-activity/preview.ts'

test('a short box is shown whole and offers nothing to open', () => {
  assert.deepEqual(previewOf([5], 0, 12), { shown: [5], total: 5, foldable: false, left: 0, next: 0 })
})

test('a box only a few lines past its preview is shown whole: folding it would hide too little', () => {
  assert.deepEqual(previewOf([16], 0, 12), { shown: [16], total: 16, foldable: false, left: 0, next: 0 })
})

test('a long box shows its first lines until opened, and all of them once it is, when they are not many', () => {
  assert.deepEqual(previewOf([40], 0, 12), { shown: [12], total: 40, foldable: true, left: 28, next: 28 })
  assert.deepEqual(previewOf([40], 1, 12), { shown: [40], total: 40, foldable: true, left: 0, next: 0 })
})

test('parts of one box share its preview in order: earlier parts whole, then a cut, then none', () => {
  assert.deepEqual(previewOf([5, 10, 8], 0, 12), { shown: [5, 7, 0], total: 23, foldable: true, left: 11, next: 11 })
  assert.deepEqual(previewOf([5, 10, 8], 1, 12), { shown: [5, 10, 8], total: 23, foldable: true, left: 0, next: 0 })
})

test('a big box opens two hundred lines at a time, each press drawing two hundred more, until the rest is few enough to draw whole', () => {
  assert.equal(OPEN_LINES, 200)
  assert.deepEqual(previewOf([1500], 0, 12), { shown: [12], total: 1500, foldable: true, left: 1488, next: 200 })
  assert.deepEqual(previewOf([1500], 1, 12), { shown: [212], total: 1500, foldable: true, left: 1288, next: 200 })
  assert.deepEqual(previewOf([1500], 7, 12), { shown: [1412], total: 1500, foldable: true, left: 88, next: 88 })
  assert.deepEqual(previewOf([1500], 8, 12), { shown: [1500], total: 1500, foldable: true, left: 0, next: 0 })
  assert.deepEqual(previewOf([214], 1, 12), { shown: [214], total: 214, foldable: true, left: 0, next: 0 }, 'a few lines past a press are drawn with it')
  assert.deepEqual(previewOf([100, 1400], 1, 12), { shown: [100, 112], total: 1500, foldable: true, left: 1288, next: 200 })
})
