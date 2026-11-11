import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import type { Place } from '../src/features/main-agent/mind.ts'
import type { ScreenId } from '../src/app/screens.ts'

// The routines store keeps its clock running; the stores load after it is held still.
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
after(() => mock.timers.reset())

const KEY = 'hobkin-client-location-1'
const place = (screen: ScreenId, more: Partial<Place> = {}): Place => ({ screen, settingsReturn: null, githubReturn: null, openAgent: null, previewReturn: null, agentTalk: false, ...more })
// What the window showed before Command+R, with a real home: a report and a routine of that home were open.
sessionStorage.setItem(KEY, JSON.stringify({
  screen: 'mind', settingsReturn: null, githubReturn: null, openAgent: 'a1', openReview: 'pr:o/r#1', reviewReturn: place('github'),
  mindReturn: place('agent', { openAgent: 'a1' }), report: 'local:recap:1', routine: 'disk-space', action: 'decision:7', githubTab: 'issues', home: '/hobkin',
}))

const { motionBetween, moveKey, readSpot, remembered, travel } = await import('../src/app/location.ts')
const { useView } = await import('../src/app/view-store.ts')
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
  assert.deepEqual(view.reviewReturn, place('github'))
  assert.deepEqual(remembered.getState(), { action: 'decision:7', githubTab: 'issues' })
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
  assert.equal(remembered.getState().githubTab, 'pulls', 'a visit starts on the first tab, as before')
  await settled()
  // Walking the agents list only looks at each agent: it is not a move.
  view().previewAgent('a3', 1)
  await settled()
  view().endAgentPreview()
  await settled()
  remembered.setState({ githubTab: 'issues' })
  await settled()
  view().openAgentCanvas('a2')
  await settled()

  assert.equal(travel(-1), true)
  assert.deepEqual([view().screen, remembered.getState().githubTab, view().screenMotion], ['github', 'issues', { axis: 'y', direction: -1 }])
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

test('a saved place is read only when it is one this window wrote', () => {
  assert.equal(readSpot(null), null)
  assert.equal(readSpot('{"screen":"pages"}'), null, 'a screen that is gone')
  assert.equal(readSpot('[1]'), null)
  const spot = readSpot('{"screen":"reports","report":"r1","reviewReturn":{"screen":"nowhere"}}')
  assert.equal(spot?.reviewReturn, null)
  assert.equal(spot && moveKey(spot), 'reports:r1')
  assert.deepEqual(motionBetween({ ...spot!, screen: 'work' }, { ...spot!, screen: 'settings', settingsReturn: 'work' }), { axis: 'y', direction: -1 }, 'settings comes down')
})
