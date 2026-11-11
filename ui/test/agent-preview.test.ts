import assert from 'node:assert/strict'
import { test } from 'node:test'
import { previewOf } from '../src/features/agent-activity/preview.ts'

test('a short box is shown whole and offers nothing to open', () => {
  assert.deepEqual(previewOf([5], false, 12), { shown: [5], total: 5, foldable: false })
})

test('a box only a few lines past its preview is shown whole: folding it would hide too little', () => {
  assert.deepEqual(previewOf([16], false, 12), { shown: [16], total: 16, foldable: false })
})

test('a long box shows its first lines until opened, and all of them once it is', () => {
  assert.deepEqual(previewOf([40], false, 12), { shown: [12], total: 40, foldable: true })
  assert.deepEqual(previewOf([40], true, 12), { shown: [40], total: 40, foldable: true })
})

test('parts of one box share its preview in order: earlier parts whole, then a cut, then none', () => {
  assert.deepEqual(previewOf([5, 10, 8], false, 12), { shown: [5, 7, 0], total: 23, foldable: true })
  assert.deepEqual(previewOf([5, 10, 8], true, 12), { shown: [5, 10, 8], total: 23, foldable: true })
})
