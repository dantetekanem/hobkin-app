import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keepsMacAwake } from '../src/main.ts'

test('only a live host on the real home keeps the Mac awake, so routines and durable hobkins run on time', () => {
  assert.equal(keepsMacAwake({ live: true }, { real: true }), true)
  assert.equal(keepsMacAwake({ live: false }, { real: true }), false, 'a scripted host on the real home runs no real work')
  assert.equal(keepsMacAwake({ live: true }, { real: false }), false, 'a throwaway home is a test or a demo')
  assert.equal(keepsMacAwake({ live: false }, { real: false }), false)
})
