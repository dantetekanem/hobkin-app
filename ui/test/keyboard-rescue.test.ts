import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rescueKeyboard, type KeyboardFall } from '../src/app/keyboard-rescue.ts'

const fall = (over: Partial<KeyboardFall> = {}): KeyboardFall => ({
  onBody: true,
  windowFocused: true,
  fromField: false,
  fromCanvas: true,
  rowKey: '[data-change="a"]',
  rowDrawn: true,
  overlayOpen: false,
  sincePointerMs: null,
  ...over,
})

test('a row that lost the keyboard to the page gets it back', () => {
  assert.deepEqual(rescueKeyboard(fall()), { to: 'row', key: '[data-change="a"]' })
})

test('a row that is gone sends the keyboard to the screen', () => {
  assert.deepEqual(rescueKeyboard(fall({ rowDrawn: false })), { to: 'screen' })
  assert.deepEqual(rescueKeyboard(fall({ rowKey: undefined })), { to: 'screen' })
})

test('the keyboard stays where it is when it is not on the page', () => {
  assert.equal(rescueKeyboard(fall({ onBody: false })), null)
})

test('the keyboard is never taken from the user', () => {
  assert.equal(rescueKeyboard(fall({ fromField: true })), null)
  assert.equal(rescueKeyboard(fall({ overlayOpen: true })), null)
  assert.equal(rescueKeyboard(fall({ windowFocused: false })), null)
  assert.equal(rescueKeyboard(fall({ sincePointerMs: 120 })), null)
})

test('a press long before the fall did not cause it', () => {
  assert.deepEqual(rescueKeyboard(fall({ sincePointerMs: 900 })), { to: 'row', key: '[data-change="a"]' })
})

test('a fall from outside the screen is left alone', () => {
  assert.equal(rescueKeyboard(fall({ fromCanvas: false, rowKey: undefined })), null)
})
