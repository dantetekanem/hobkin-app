import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Review } from '#shared/review/types.ts'
import { pressKey, type KeyEffects } from '../src/features/review/keys.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review

function heard() {
  const moves: number[] = []
  const panel: string[] = []
  const effects: KeyEffects = { panelKey: (key) => (panel.push(key), true), toggleSteps: () => {}, verdict: () => {}, proofKey: () => {}, moveLayer: (direction) => void moves.push(direction) }
  const session = createSession(sample, createReviewMemory(memoryStorage()))
  const press = (key: string, shift = key === '{' || key === '}') => pressKey(session.getState(), { key, shift, alt: false }, effects)
  return { moves, panel, press, session }
}

test('{ goes to the layer under and } to the layer over, and they are the review\'s', () => {
  const { moves, press } = heard()
  assert.equal(press('{'), true)
  assert.equal(press('}'), true)
  assert.deepEqual(moves, [-1, 1])
})

test('[ and ] stay the code panel\'s: with the code open they still go to the file before and after', () => {
  const { moves, panel, press, session } = heard()
  session.getState().goTo(3)
  session.getState().toggleCode()
  assert.ok(session.getState().code)
  press('[', false)
  press(']', false)
  assert.deepEqual(panel, ['[', ']'])
  assert.deepEqual(moves, [])
})

test('with the code open, { and } still move between layers', () => {
  const { moves, press, session } = heard()
  session.getState().goTo(3)
  session.getState().toggleCode()
  assert.equal(press('}'), true)
  assert.deepEqual(moves, [1])
})
