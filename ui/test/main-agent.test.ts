import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import { walkScreens } from '../src/app/screens.ts'
import { intoMind, mainActivityOf, outOfMind, quietLine, quietSince, type Place } from '../src/features/main-agent/mind.ts'
import { withFixturePart } from './integration-fixture.ts'

withFixturePart()

const place = (overrides: Partial<Place> = {}): Place => ({ screen: 'reports', settingsReturn: null, screenReturn: null, openAgent: null, previewReturn: null, ...overrides })

test("the main agent's steps come from the snapshot, and a host that sends none at all is older than the view", () => {
  const entries: ActivityEntry[] = [{ id: 'message:1:0', kind: 'assistant', text: 'Looking.' }]
  assert.equal(mainActivityOf({ mainActivity: entries }), entries)
  assert.deepEqual(mainActivityOf({ mainActivity: [] }), [], 'nothing yet is not too old')
  assert.equal(mainActivityOf({}), null)
})

test('the mind comes in from the chat side, and leaving it goes back to where the canvas was', () => {
  const onAgent = place({ screen: 'agent', openAgent: 'a1', previewReturn: 'routines' })
  const opened = intoMind(onAgent, null)
  assert.deepEqual(opened.view, { screen: 'mind', settingsReturn: null, previewReturn: null, screenMotion: { axis: 'x', direction: -1 } })
  assert.deepEqual(opened.back, onAgent)
  assert.deepEqual(outOfMind(opened.back), { ...onAgent, screenMotion: { axis: 'x', direction: 1 } })
  assert.equal(outOfMind(null).screen, 'reports', 'with no way back, as after a reload, the first screen')
})

test('opened from a screen over the mind, it keeps the way back it had', () => {
  const first = intoMind(place({ screen: 'work' }), null).back
  for (const over of [place({ screen: 'settings', settingsReturn: 'mind' }), place({ screen: 'agent', openAgent: 'a1', previewReturn: 'mind' }), place({ screen: 'github', screenReturn: 'mind' })]) {
    assert.equal(intoMind(over, first).back, first, over.screen)
  }
  assert.deepEqual(intoMind(place({ screen: 'settings', settingsReturn: 'work' }), first).back.screen, 'settings', 'a screen that is not over it is a new way back')
})

test('the mind is not one of the numbered screens', () => {
  assert.ok(!walkScreens({ screen: 'mind', reviewOpen: false, outOfMenu: [] }).includes('mind'))
})

test('between steps the mind counts how long hobkin has been quiet: from its last step, or from a turn that began after it', () => {
  const now = 1_000_000
  assert.equal(quietSince(now - 12_000, null), now - 12_000, 'from the last step')
  assert.equal(quietSince(now - 30_000, now - 5_000), now - 5_000, 'from a turn that began after the last step')
  assert.equal(quietSince(now - 5_000, now - 30_000), now - 5_000, 'a turn that began before the last step counts from the step')
  assert.equal(quietSince(undefined, now - 8_000), now - 8_000, 'before the first step, from the turn')
  assert.equal(quietSince(undefined, null), undefined, 'nothing to count from')

  assert.equal(quietLine('thinking', now - 12_000, now), 'Thinking · 12s')
  assert.equal(quietLine('thinking', now - 65_000, now), 'Thinking · 1m 05s')
  assert.equal(quietLine('compacting', now - 1_500, now), 'Compacting', 'under two seconds it says only what it does')
  assert.equal(quietLine('thinking', undefined, now), 'Thinking')
  assert.equal(quietLine('thinking', now + 4_000, now), 'Thinking', 'never below zero')
})
