import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import { useView } from '../src/app/view-store.ts'
import { inMenu, walkScreens } from '../src/app/screens.ts'
import { hostStore } from '../src/lib/host/client.ts'
import { sampleWork } from '../src/features/work/sample.ts'
import { withFixturePart } from './integration-fixture.ts'

withFixturePart()

mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
after(() => mock.timers.reset())
const { readSpot, travel } = await import('../src/app/location.ts')
const settle = () => new Promise<void>(resolve => queueMicrotask(resolve))
const work = { ...sampleWork(), projects: sampleWork().projects.slice(0, 3).map((p, i) => ({ ...p, slug: `exact-${i}`, state: 'chosen' as const })) }

function fixture() {
  hostStore.setState({ home: '/fixture', epoch: 1, link: 'open', work })
  useView.setState({ screen: 'work', openAgent: null, previewReturn: null, trail: [] })
}

test('World is contextual; visible positional shortcuts still start at Home', () => {
  assert.equal(inMenu('world'), false)
  assert.deepEqual(walkScreens({ screen: 'world', outOfMenu: [], reviewOpen: false }), ['home', 'reports', 'routines', 'actions', 'work', 'github'])
  assert.equal(readSpot(JSON.stringify({ screen: 'world' }))?.screen, 'world')
})

test('Work to World to agent returns to World, with Back and Forward retaining it', async () => {
  fixture()
  await settle()
  useView.getState().openScreen('world')
  await settle()
  useView.getState().openAgentCanvas('exact-run')
  await settle()
  useView.getState().closeAgentCanvas()
  assert.equal(useView.getState().screen, 'world')
  await settle()
  assert.equal(travel(-1), true)
  assert.equal(useView.getState().screen, 'agent')
  travel(-1)
  assert.equal(useView.getState().screen, 'world')
  travel(-1)
  assert.equal(useView.getState().screen, 'work')
  travel(1)
  assert.equal(useView.getState().screen, 'world')
})
