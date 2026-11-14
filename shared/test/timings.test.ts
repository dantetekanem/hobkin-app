import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkArguments } from '#shared/commands/registry.ts'
import { SHOWN_ID_MAX, SHOWN_MAX_MS, shownFacts } from '#shared/protocol/timings.ts'

const SENT_AT = Date.parse('2026-11-14T10:00:00Z')

test('a send and a message to a durable hobkin take the time the user sent them, as a whole number of milliseconds', () => {
  for (const [name, args] of [
    ['conversation.send', { text: 'Plan the week' }],
    ['hobkin.say', { id: 'a1b2c3d4', text: 'Go on.' }],
  ] as const) {
    assert.equal(checkArguments(name, args).ok, true, `${name} without it`)
    assert.equal(checkArguments(name, { ...args, sentAt: SENT_AT }).ok, true, `${name} with it`)
    for (const sentAt of [-1, 1.5, '1700000000000', null]) {
      assert.equal(checkArguments(name, { ...args, sentAt }).ok, false, `${name} refuses ${JSON.stringify(sentAt)}`)
    }
  }
})

test('a shown message is kept with its run id and its two times, and nothing else', () => {
  assert.deepEqual(shownFacts({ type: 'shown', id: 'run-1', arrivedMs: 812, shownMs: 950, text: 'Hello' }), { id: 'run-1', arrivedMs: 812, shownMs: 950 })
  assert.deepEqual(shownFacts({ type: 'shown', id: 'r'.repeat(SHOWN_ID_MAX), arrivedMs: 0, shownMs: SHOWN_MAX_MS }), { id: 'r'.repeat(SHOWN_ID_MAX), arrivedMs: 0, shownMs: SHOWN_MAX_MS })
  assert.deepEqual(shownFacts({ type: 'shown', id: 'run-1', arrivedMs: 400, shownMs: 400 }), { id: 'run-1', arrivedMs: 400, shownMs: 400 }, 'shown in the same frame it arrived')
})

test('a shown message with a bad id or times out of order or out of range is not kept', () => {
  const good = { type: 'shown', id: 'run-1', arrivedMs: 812, shownMs: 950 }
  for (const [why, message] of [
    ['no id', { ...good, id: undefined }],
    ['an empty id', { ...good, id: '' }],
    ['a number for an id', { ...good, id: 7 }],
    ['an id too long', { ...good, id: 'r'.repeat(SHOWN_ID_MAX + 1) }],
    ['shown before it arrived', { ...good, arrivedMs: 951 }],
    ['a negative time', { ...good, arrivedMs: -1 }],
    ['a time past the limit', { ...good, shownMs: SHOWN_MAX_MS + 1 }],
    ['a time that is not a number', { ...good, shownMs: '950' }],
    ['a time that is not finite', { ...good, shownMs: Infinity }],
    ['nothing', null],
  ] as const) {
    assert.equal(shownFacts(message), null, why)
  }
})
