import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inProofPanel, keyOwner, type HeardKey } from '../src/features/review/keys.ts'

const key = (name: string, more: Partial<HeardKey> = {}): HeardKey => ({ key: name, shift: false, meta: false, ctrl: false, alt: false, typing: false, ...more })

test("while the keyboard is in the proof beside the review, every key is the proof's but T, Shift+T, Escape and ⌘?, which are the review's too", () => {
  // The proof's own keys, and every other one the review would take, such as A for approve or S for its panel.
  for (const name of ['j', 'k', 'f', '1', '2', '3', '/', 'r', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'a', 'm', 'x', 's', 'u', 'l', 'z', 'n', 'g', 'o', 'p']) {
    assert.equal(keyOwner(key(name), true), 'proof', name)
  }
  assert.equal(keyOwner(key('F', { shift: true }), true), 'proof', 'Shift+F is the proof’s')
  assert.equal(keyOwner(key('U', { shift: true }), true), 'proof', 'Shift+U is the proof’s')
  // T and Escape close the proof and Shift+T opens its page: the proof does it, and the review does it for a proof that cannot.
  assert.equal(keyOwner(key('t'), true), 'review')
  assert.equal(keyOwner(key('T', { shift: true }), true), 'review')
  assert.equal(keyOwner(key('Escape'), true), 'review')
  // ⌘? lists the review's keys from anywhere in it.
  assert.equal(keyOwner(key('?', { meta: true, shift: true }), true), 'review')
  // Typing in the proof's search, every key is the field's, Escape and T among them.
  for (const name of ['t', 'Escape', 'a']) assert.equal(keyOwner(key(name, { typing: true }), true), 'proof', `${name} while typing`)
  // With Option or Control a key is no review key, in the proof or out of it.
  assert.equal(keyOwner(key('t', { alt: true }), true), 'proof')
})

test('with the keyboard anywhere else in the review, every key is the review’s', () => {
  for (const name of ['t', 'T', 'Escape', 'j', 'a', 'ArrowRight']) assert.equal(keyOwner(key(name), false), 'review', name)
})

test('the proof beside the review is any part of the box the proof panel draws', () => {
  const inside = { closest: (selector: string) => (selector === '[data-proof-panel]' ? {} : null) }
  const outside = { closest: () => null }
  assert.equal(inProofPanel(inside), true)
  assert.equal(inProofPanel(outside), false)
  assert.equal(inProofPanel(null), false)
  assert.equal(inProofPanel({}), false, 'a target that is no element, such as the window')
})
