import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pageShownId } from '../src/features/hobkins/page-shown.ts'

const waiting = { id: 'a1b2c3d4', state: 'waiting' as const, engine: { kind: 'tier' as const, tier: 'fast' as const } }

test("the hobkin's id comes back when its page is on screen, the window shows, and it waits on Pi", () => {
  assert.equal(pageShownId({ onPage: true, windowShowing: true, hobkin: waiting }), 'a1b2c3d4')
  assert.equal(pageShownId({ onPage: true, windowShowing: true, hobkin: { ...waiting, engine: { kind: 'pi', model: 'a/b', effort: 'low' } } }), 'a1b2c3d4')
})

test('nothing comes back while the page is away, the window is hidden, it works, runs on Claude Code or is missing', () => {
  assert.equal(pageShownId({ onPage: false, windowShowing: true, hobkin: waiting }), null)
  assert.equal(pageShownId({ onPage: true, windowShowing: false, hobkin: waiting }), null)
  assert.equal(pageShownId({ onPage: true, windowShowing: true, hobkin: { ...waiting, state: 'working' } }), null)
  assert.equal(pageShownId({ onPage: true, windowShowing: true, hobkin: { ...waiting, engine: { kind: 'claude' } } }), null)
  assert.equal(pageShownId({ onPage: true, windowShowing: true, hobkin: null }), null)
})
