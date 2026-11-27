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
// What the window showed before Command+R, with a real home: a report and a routine of that home were open.
sessionStorage.setItem(KEY, JSON.stringify({
  screen: 'mind', settingsReturn: null, screenReturn: null, openAgent: 'a1', openReview: 'pr:o/r#1', reviewReturn: place('github'),
  agentReturn: 'routines', mindReturn: place('agent', { openAgent: 'a1' }), report: 'local:recap:1', routine: 'disk-space', action: 'decision:7', githubTab: 'issues', githubProject: 'storefront', home: '/hobkin',
}))

const { motionBetween, moveKey, readSpot, remembered, travel } = await import('../src/app/location.ts')
const { useView } = await import('../src/app/view-store.ts')
const { keepPart, takeArrival } = await import('../src/app/kept-place.ts')
const { useReports } = await import('../src/features/reports/store.ts')
const { useRoutines } = await import('../src/features/routines/store.ts')
const { hostStore } = await import('../src/lib/host/client.ts')
const { applyHostMessage } = await import('../src/lib/host/state.ts')

const settled = () => new Promise<void>((resolve) => queueMicrotask(resolve))
const report = { id: 'local:recap:1', title: 'Morning recap', body: 'Useful: A finding.', outcome: 'completed', at: '2026-11-10T08:00:00Z' }

test('a reload comes back to the same screen and its way back, and to the details once their home has them', async () => {
  const view = useView.getState()
  assert.deepEqual([view.screen, view.openAgent, view.openReview], ['mind', 'a1', 'pr:o/r#1'])
  assert.deepEqual(view.mindReturn, place('agent', { openAgent: 'a1' }), "the mind's way back")
  assert.deepEqual(view.trail, [{ screen: 'routines' }], "the agent's way back under the mind, as a trail; the review's leads nowhere from here")
  assert.deepEqual(remembered.getState(), { action: 'decision:7', pages: { github: { tab: 'issues', project: 'storefront' } } })
  assert.equal(useRoutines.getState().openId, null, 'a sample routine of the same name is not the one that was open')

  hostStore.setState({ home: '/hobkin', link: 'open' })
  hostStore.setState((state) => applyHostMessage(state, { type: 'state', rev: 1, reset: true, set: { reports: [report] } }))
  assert.equal(useReports.getState().openId, 'local:recap:1', 'the report opens once the home sends it')
  assert.equal(useRoutines.getState().openId, null, 'a routine the home no longer has falls back to the list')

  await settled()
  const saved = readSpot(sessionStorage.getItem(KEY))
  assert.equal(saved?.report, 'local:recap:1', 'the place is kept for the next reload')
  assert.equal(saved?.screen, 'mind')
})

test('command left and right walk back and forward through the moves, with the slide each move has', async () => {
  const view = () => useView.getState()
  view().openScreen('work')
  await settled()
  view().openScreen('github')
  assert.deepEqual(remembered.getState().pages, {}, 'a visit starts on the first tab and on All, as before')
  await settled()
  // Walking the agents list only looks at each agent: it is not a move.
  view().previewAgent('a3', 1)
  await settled()
  view().endAgentPreview()
  await settled()
  remembered.setState({ pages: { github: { tab: 'issues', project: 'docs-site' } } })
  await settled()
  view().openAgentCanvas('a2')
  await settled()

  assert.equal(travel(-1), true)
  assert.deepEqual([view().screen, remembered.getState().pages.github?.tab, remembered.getState().pages.github?.project, view().screenMotion], ['github', 'issues', 'docs-site', { axis: 'y', direction: -1 }])
  travel(-1)
  assert.deepEqual([view().screen, view().screenMotion], ['work', { axis: 'x', direction: -1 }])
  travel(-1)
  assert.deepEqual([view().screen, view().mindReturn?.screen, view().screenMotion], ['mind', 'agent', { axis: 'x', direction: -1 }])
  assert.equal(travel(-1), false, 'the first place of the window')

  travel(1)
  assert.deepEqual([view().screen, view().screenMotion], ['work', { axis: 'x', direction: 1 }])
  await settled()
  view().openScreen('routines')
  await settled()
  assert.equal(travel(1), false, 'a new move forgets the way forward')
  assert.equal(travel(-1), true)
  assert.equal(view().screen, 'work')
})

test('a detail is a move of its own, and a screen entered anew starts on its list', async () => {
  useView.getState().openScreen('reports')
  useReports.getState().close()
  await settled()
  useReports.getState().open('local:recap:1')
  await settled()
  travel(-1)
  assert.equal(useReports.getState().openId, null, 'back to the list')
  travel(1)
  assert.equal(useReports.getState().openId, 'local:recap:1')

  remembered.setState({ action: 'decision:7' })
  useView.getState().openScreen('actions')
  assert.equal(remembered.getState().action, null)
})

test('an agent keeps its return across saved locations and back/forward, without resetting the screen below', async () => {
  useView.getState().openScreen('github')
  remembered.setState({ pages: { github: { tab: 'issues' } } })
  await settled()
  useView.getState().previewAgent('a1', 1)
  useView.getState().openAgentCanvas('a1')
  await settled()
  assert.equal(readSpot(sessionStorage.getItem(KEY))?.trail.at(-1)?.screen, 'github', 'Command+R saves the way back')
  useView.getState().closeAgentCanvas()
  await settled()
  assert.equal(remembered.getState().pages.github?.tab, 'issues', 'returning is not a new GitHub visit')
  travel(-1)
  assert.equal(useView.getState().screen, 'agent')
  assert.equal(useView.getState().trail.at(-1)?.screen, 'github', 'back restores the same way back')
  useView.getState().closeAgentCanvas()
  assert.equal(useView.getState().screen, 'github')
})

test('Home is a restorable location and back/forward preserves report and routine destinations', async () => {
  assert.equal(readSpot('{"screen":"home"}')?.screen, 'home')
  useView.getState().openScreen('reports')
  await settled()
  useView.getState().openScreen('home')
  await settled()
  useView.getState().openScreen('routines')
  await settled()
  assert.equal(travel(-1), true)
  assert.equal(useView.getState().screen, 'home')
  assert.equal(travel(-1), true)
  assert.equal(useView.getState().screen, 'reports')
  travel(1)
  travel(1)
  assert.equal(useView.getState().screen, 'routines')
})

test('history keeps the scroll of each Home visit, including changes made after going back', async (t) => {
  const view = () => useView.getState()
  let scroll = 620
  t.after(keepPart('home', 'page', { read: () => ({ scroll }) }))
  view().openMenuScreen('home')
  await settled()
  view().openMenuScreen('work')
  await settled()
  view().openMenuScreen('home')
  await settled()
  scroll = 180

  travel(-1)
  travel(-1)
  assert.equal(takeArrival('home')?.scroll, 620)
  assert.equal(view().screenMotion.resumed, true)
  scroll = 315
  travel(1)
  travel(1)
  assert.equal(takeArrival('home')?.scroll, 180)
  travel(-1)
  travel(-1)
  assert.equal(takeArrival('home')?.scroll, 315)
})

test('the canvas place is a move of its own along the side, and Command+R keeps its way back', async () => {
  useView.getState().openScreen('reports')
  await settled()
  useView.getState().toggleSettings()
  await settled()
  useView.getState().openCanvasPlace()
  await settled()
  const saved = readSpot(sessionStorage.getItem(KEY))
  assert.equal(saved?.screen, 'canvas')
  assert.deepEqual(saved?.canvasReturn, place('settings', { settingsReturn: 'reports' }), 'the way back is kept for the reload')

  assert.equal(travel(-1), true)
  assert.deepEqual([useView.getState().screen, useView.getState().screenMotion], ['settings', { axis: 'x', direction: -1 }], 'back along the side, as closing goes')
  travel(1)
  assert.deepEqual([useView.getState().screen, useView.getState().canvasReturn, useView.getState().screenMotion], ['canvas', place('settings', { settingsReturn: 'reports' }), { axis: 'x', direction: 1 }])
  useView.getState().closeCanvasPlace()
  assert.equal(useView.getState().screen, 'settings')
  useView.getState().closeSettings()
  assert.equal(readSpot('{"screen":"canvas","canvasReturn":{"screen":"nowhere"}}')?.canvasReturn, null)
})

test('a saved place is read only when it is one this window wrote', () => {
  assert.equal(readSpot(null), null)
  assert.equal(readSpot('{"screen":"pages"}'), null, 'a screen that is gone')
  assert.equal(readSpot('[1]'), null)
  const spot = readSpot('{"screen":"reports","report":"r1","trail":[{"screen":"nowhere"}]}')
  assert.deepEqual(spot?.trail, [])
  assert.equal(spot && moveKey(spot), 'reports:r1')
  assert.deepEqual(motionBetween({ ...spot!, screen: 'work' }, { ...spot!, screen: 'settings', settingsReturn: 'work' }), { axis: 'y', direction: -1 }, 'settings comes down')
})
