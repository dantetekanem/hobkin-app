import assert from 'node:assert/strict'
import { test } from 'node:test'
import { proofKey, type ProofKeyPress } from '../src/features/proofs/proof-keys.ts'

const press = (key: string, more: Partial<ProofKeyPress> = {}): ProofKeyPress => ({ key, shift: false, meta: false, ctrl: false, alt: false, typing: false, ...more })
const page = { panel: false }
const panel = { panel: true }

test("the proof's keys: J and K for the models, F and Shift+F for what failed, 1 2 3 for its parts, / to search, R to run again", () => {
  assert.deepEqual(proofKey(press('j'), page), { do: 'sibling', delta: 1 })
  assert.deepEqual(proofKey(press('k'), page), { do: 'sibling', delta: -1 })
  assert.deepEqual(proofKey(press('f'), page), { do: 'failure', delta: 1 })
  assert.deepEqual(proofKey(press('F', { shift: true }), page), { do: 'failure', delta: -1 })
  assert.deepEqual(proofKey(press('1'), page), { do: 'part', part: 'run' })
  assert.deepEqual(proofKey(press('2'), page), { do: 'part', part: 'graph' })
  assert.deepEqual(proofKey(press('3'), page), { do: 'part', part: 'math' })
  assert.deepEqual(proofKey(press('/'), page), { do: 'search' })
  assert.deepEqual(proofKey(press('r'), page), { do: 'again' })
  // Caps Lock gives the capitals with no Shift.
  assert.deepEqual(proofKey(press('J'), page), { do: 'sibling', delta: 1 })
})

test('none acts while typing in a field, with Command, Control or Option, or while composing', () => {
  for (const key of ['j', 'k', 'f', '1', '/', 'r', 'Escape', 't', 'ArrowDown']) {
    assert.equal(proofKey(press(key, { typing: true }), panel), null, key)
  }
  assert.equal(proofKey(press('j', { meta: true }), page), null)
  assert.equal(proofKey(press('1', { ctrl: true }), page), null)
  assert.equal(proofKey(press('f', { alt: true }), page), null)
  assert.equal(proofKey(press('j', { composing: true }), page), null)
  assert.equal(proofKey(press('J', { shift: true }), page), null, 'Shift+J is not J')
  assert.equal(proofKey(press('4'), page), null)
})

test('in a panel beside another page, Escape and T close it, Shift+T expands it, and Up and Down walk its stops', () => {
  assert.deepEqual(proofKey(press('Escape'), panel), { do: 'close' })
  assert.deepEqual(proofKey(press('t'), panel), { do: 'close' })
  assert.deepEqual(proofKey(press('T', { shift: true }), panel), { do: 'expand' })
  assert.deepEqual(proofKey(press('ArrowDown'), panel), { do: 'walk', delta: 1 })
  assert.deepEqual(proofKey(press('ArrowUp'), panel), { do: 'walk', delta: -1 })
  // On the page they stay the frame's: Escape goes back, and the screen walks its own stops.
  for (const key of ['Escape', 't', 'ArrowDown', 'ArrowUp']) assert.equal(proofKey(press(key), page), null, key)
  assert.equal(proofKey(press('T', { shift: true }), page), null)
})
