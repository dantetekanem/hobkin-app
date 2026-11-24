import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import type { Place } from '../src/features/main-agent/mind.ts'
import type { ScreenId } from '../src/app/screens.ts'
import { withFixturePart } from './integration-fixture.ts'

withFixturePart()

// The routines store keeps its clock running; the stores load after it is held still.
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
after(() => mock.timers.reset())

const KEY = 'hobkin-client-location-1'
const place = (screen: ScreenId, more: Partial<Place> = {}): Place => ({ screen, settingsReturn: null, screenReturn: null, openAgent: null, previewReturn: null, ...more })
// What a window saved before the trail: a proof opened from a review, opened from an agent, opened from YOLO mode, each
// with its single way back.
sessionStorage.setItem(KEY, JSON.stringify({
  screen: 'proof', settingsReturn: null, screenReturn: null, openAgent: 'a1', agentReturn: 'yolo', openReview: 'change:hobkin-api:7',
  reviewReturn: place('agent', { openAgent: 'a1' }), openProof: 'run-1', proofReturn: place('review'), mindReturn: null, canvasReturn: null,
}))

const { moveKey, readSpot } = await import('../src/app/location.ts')
const { useView } = await import('../src/app/view-store.ts')

const view = () => useView.getState()
const settled = () => new Promise<void>((resolve) => queueMicrotask(resolve))

test('a place saved with the three old ways back comes back as the trail they stood for', () => {
  assert.deepEqual([view().screen, view().openProof], ['proof', 'run-1'])
  assert.deepEqual(view().trail, [{ screen: 'yolo' }, { screen: 'agent', about: 'a1' }, { screen: 'review', about: 'change:hobkin-api:7' }])
  view().leave()
  assert.deepEqual([view().screen, view().openReview], ['review', 'change:hobkin-api:7'], 'and Escape walks it as it did')
  view().leave()
  assert.deepEqual([view().screen, view().openAgent], ['agent', 'a1'])
  view().leave()
  assert.equal(view().screen, 'yolo')
})

test("a way back that does not lead to the page is no part of its trail, as a review's after its agent", () => {
  const spot = readSpot(JSON.stringify({ screen: 'mind', mindReturn: place('agent', { openAgent: 'a1' }), agentReturn: 'routines', reviewReturn: place('github') }))
  assert.deepEqual(spot?.trail, [{ screen: 'routines' }], "the mind's place under it leads to the agent's way back")
})

test('Command+R keeps the trail and the project page, and leaves out a place that is gone or about nothing', async () => {
  view().openMenuScreen('work')
  view().openScreen('yolo')
  view().openProject('hobkin-api')
  await settled()
  const saved = readSpot(sessionStorage.getItem(KEY))
  assert.deepEqual([saved?.screen, saved?.project, saved?.trail], ['project', 'hobkin-api', [{ screen: 'work' }, { screen: 'yolo' }]])
  assert.equal(saved && moveKey(saved), 'project:hobkin-api', 'another project is another move')

  const odd = readSpot(JSON.stringify({
    screen: 'review', openReview: 'r1',
    trail: [
      { screen: 'nowhere' }, { screen: 'work', keep: { tab: 'reviews', focus: 7, scroll: -3 } }, 'yolo',
      { screen: 'agent', about: '' }, { screen: 'review' }, { screen: 'proof', about: 7 }, { screen: 'project' }, { screen: 'agent', about: 'a1' },
    ],
  }))
  // Going back to an agent, a review, a run or a project with no id would land on an empty page.
  assert.deepEqual(odd?.trail, [{ screen: 'work', keep: { tab: 'reviews' } }, { screen: 'agent', about: 'a1' }])
  const slots = readSpot(JSON.stringify({ screen: 'proof', openProof: 'run-1', proofReturn: place('agent'), agentReturn: 'yolo' }))
  assert.deepEqual(slots?.trail, [{ screen: 'yolo' }], 'an old way back to an agent it no longer names is left out too')
  const long = readSpot(JSON.stringify({ screen: 'proof', trail: ['home', 'work', 'yolo', 'world', 'reports', 'routines', 'actions'].map((screen) => ({ screen })) }))
  assert.deepEqual(long?.trail.map(({ screen }) => screen), ['yolo', 'world', 'reports', 'routines', 'actions'], 'never more than six with the page')
})
