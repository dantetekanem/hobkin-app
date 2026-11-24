import assert from 'node:assert/strict'
import { test } from 'node:test'
import { faceMotion, SMALL_FACE_PX } from '../src/avatar/face-motion.ts'

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
