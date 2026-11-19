import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keepEqual, sameFields, sameLists } from '../src/lib/host/frame.ts'

const agent = (doing: string, extra: object = {}) => ({ id: 'run-1', title: 'Fix the login', doing, mood: 'working', hue: 40, ...extra })

test('two values say the same when every field is the same, a nested object by its own fields', () => {
  assert.ok(sameFields(agent('running read'), agent('running read')))
  assert.ok(!sameFields(agent('running read'), agent('thinking')))
  assert.ok(sameFields(agent('waiting', { durable: { id: 'h', state: 'waiting' } }), agent('waiting', { durable: { id: 'h', state: 'waiting' } })))
  assert.ok(!sameFields(agent('waiting', { durable: { id: 'h', state: 'waiting' } }), agent('waiting', { durable: { id: 'h', state: 'working' } })))
  assert.ok(!sameFields(agent('x'), agent('x', { asks: 'Which one?' })), 'a field one has and the other does not')
  assert.ok(sameFields(undefined, undefined))
  assert.ok(!sameFields(agent('x'), undefined))
})

test('two lists say the same when they hold the same values in the same order', () => {
  assert.ok(sameLists([agent('a'), agent('b')], [agent('a'), agent('b')], sameFields))
  assert.ok(!sameLists([agent('a'), agent('b')], [agent('b'), agent('a')], sameFields))
  assert.ok(!sameLists([agent('a')], [agent('a'), agent('b')], sameFields))
  assert.ok(sameLists(['a', 'b'], ['a', 'b']))
})

test('a value that says the same as the one held is the one held, so what draws it does not draw again', () => {
  const held = agent('running read')
  assert.equal(keepEqual(held, agent('running read'), sameFields), held)
  const changed = agent('thinking')
  assert.equal(keepEqual(held, changed, sameFields), changed)
  const first = agent('x')
  assert.equal(keepEqual(undefined, first, sameFields), first)
})
