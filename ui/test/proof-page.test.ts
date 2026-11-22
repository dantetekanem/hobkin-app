import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Place } from '../src/features/main-agent/mind.ts'
import type { ScreenId } from '../src/app/screens.ts'
import { launchView, useView } from '../src/app/view-store.ts'

const view = () => useView.getState()
const place = (screen: ScreenId, more: Partial<Place> = {}): Place => ({ screen, settingsReturn: null, githubReturn: null, openAgent: null, previewReturn: null, ...more })
const start = (screen: ScreenId, more: Partial<Place> = {}) => useView.setState({ ...place(screen), openProof: null, trail: [], ...more })

test("a proof run's page comes in from the right and goes back to where it was opened, an agent's page as it was", () => {
  start('agent', { openAgent: 'hobkin:0123abcd' })
  view().openProofRun('run-1')
  assert.deepEqual([view().screen, view().openProof, view().screenMotion], ['proof', 'run-1', { axis: 'x', direction: 1 }])
  assert.deepEqual(view().trail, [{ screen: 'agent', about: 'hobkin:0123abcd' }])

  // Run again follows the new run on the same page, with the same way back.
  view().openProofRun('run-2')
  assert.deepEqual([view().openProof, view().trail], ['run-2', [{ screen: 'agent', about: 'hobkin:0123abcd' }]])

  view().closeProof()
  assert.deepEqual([view().screen, view().openAgent, view().trail, view().screenMotion], ['agent', 'hobkin:0123abcd', [], { axis: 'x', direction: -1 }])
})

test('with no way back it returns to Work, and a new launch never reopens a proof run', () => {
  start('proof')
  view().closeProof()
  assert.equal(view().screen, 'work')

  start('yolo')
  view().openProofRun('run-1')
  assert.equal(launchView(view()).screen, 'work')
})
