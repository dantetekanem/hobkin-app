import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import { walkScreens } from '../src/app/screens.ts'
import { intoMind, mainActivityOf, outOfMind, type Place } from '../src/features/main-agent/mind.ts'

const place = (overrides: Partial<Place> = {}): Place => ({ screen: 'reports', settingsReturn: null, githubReturn: null, openAgent: null, previewReturn: null, ...overrides })

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
  for (const over of [place({ screen: 'settings', settingsReturn: 'mind' }), place({ screen: 'agent', openAgent: 'a1', previewReturn: 'mind' }), place({ screen: 'github', githubReturn: 'mind' })]) {
    assert.equal(intoMind(over, first).back, first, over.screen)
  }
  assert.deepEqual(intoMind(place({ screen: 'settings', settingsReturn: 'work' }), first).back.screen, 'settings', 'a screen that is not over it is a new way back')
})

test('the mind is not one of the numbered screens', () => {
  assert.ok(!walkScreens({ screen: 'mind', reviewOpen: false, githubInMenu: true }).includes('mind'))
})
