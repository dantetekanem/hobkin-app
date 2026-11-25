import assert from 'node:assert/strict'
import { test } from 'node:test'
import { faceMotion, faceMovement, SMALL_FACE_PX } from '../src/avatar/face-motion.ts'

test('a face under 40 px holds its parts and moves as a whole in its mood', () => {
  assert.equal(SMALL_FACE_PX, 40)
  assert.deepEqual(faceMotion({ size: 35, mood: 'working', still: false }), { parts: false, whole: 'working' })
  assert.deepEqual(faceMotion({ size: 17, mood: 'confused', still: false }), { parts: false, whole: 'confused' })
  assert.deepEqual(faceMotion({ size: 39.9, mood: 'sleepy', still: false }), { parts: false, whole: 'sleepy' })
})

test('a face of 40 px or more moves each of its parts in its mood', () => {
  assert.deepEqual(faceMotion({ size: 40, mood: 'working', still: false }), { parts: true, whole: null })
  assert.deepEqual(faceMotion({ size: 184, mood: 'celebrating', still: false }), { parts: true, whole: null })
})

test('a still face holds its parts and its box at any size', () => {
  assert.deepEqual(faceMotion({ size: 24, mood: 'working', still: true }), { parts: false, whole: null })
  assert.deepEqual(faceMotion({ size: 104, mood: 'working', still: true }), { parts: false, whole: null })
})

test('under Lively every face keeps looping its mood, even when the Mac asks for less motion', () => {
  assert.equal(faceMovement('lively', false), 'loops')
  assert.equal(faceMovement('lively', true), 'loops')
})

test('following the Mac a face plays its mood when it changes, and holds still when the Mac asks for less', () => {
  assert.equal(faceMovement('system', false), 'plays on change')
  assert.equal(faceMovement('system', true), 'still')
  // The page before Settings marks it moves as Follow the Mac does.
  assert.equal(faceMovement(null, false), 'plays on change')
  assert.equal(faceMovement(null, true), 'still')
})

test('under Still no face moves', () => {
  assert.equal(faceMovement('still', false), 'still')
  assert.equal(faceMovement('still', true), 'still')
})
