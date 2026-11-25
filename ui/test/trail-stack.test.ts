import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { resolveEscape, type KeyContext } from '../src/app/key-map.ts'
import { drawnPlaces, MOST_PLACES, shownTrail } from '../src/app/trail.ts'
import { useView } from '../src/app/view-store.ts'
import { withFixturePart } from './integration-fixture.ts'

withFixturePart()

const view = () => useView.getState()
const shown = () => shownTrail(view()).map(({ screen, about }) => (about ? `${screen}:${about}` : screen))

beforeEach(() => {
  useView.setState({
    screen: 'home',
    trail: [],
    openAgent: null,
    openReview: null,
    openProof: null,
    project: null,
    settingsReturn: null,
    screenReturn: null,
    previewReturn: null,
    previewFrom: null,
    mindReturn: null,
    canvasReturn: null,
  })
})

/** Work, YOLO mode, a project, its review and a proof, as the user would reach them. */
function walkToTheProof() {
  view().openMenuScreen('work')
  view().openScreen('yolo')
  view().openProject('hobkin-api')
  view().openReviewFor('change:hobkin-api:7')
  view().openProofRun('run-1')
}

test('every page shows a trail whose last place is the page itself', () => {
  assert.deepEqual(shown(), ['home'], 'a page reached from nowhere is the whole trail')
  walkToTheProof()
  assert.deepEqual(shown(), ['work', 'yolo', 'project:hobkin-api', 'review:change:hobkin-api:7', 'proof:run-1'], 'all five, oldest first')
  assert.equal(view().trail.length, 4, 'the page itself is not on the stack, only the places before it')
})

test('a click on an earlier place goes back to it, and the places after it leave the trail', () => {
  walkToTheProof()
  view().backTo(1)
  assert.equal(view().screen, 'yolo')
  assert.deepEqual(shown(), ['work', 'yolo'])
  assert.equal(view().openReview, null, 'the review left the trail with its page')
  assert.deepEqual(view().screenMotion, { axis: 'x', direction: -1 }, 'back comes in from the left')
})

test('going to a place already on the trail goes back to it instead of adding it again', () => {
  walkToTheProof()
  view().openReviewFor('change:hobkin-api:7')
  assert.deepEqual(shown(), ['work', 'yolo', 'project:hobkin-api', 'review:change:hobkin-api:7'], 'the same review is the place it was')
  view().openScreen('work')
  assert.deepEqual(shown(), ['work'])
})

test('opening a menu page from the menu, Command with a number or the spotlight starts a new trail', () => {
  walkToTheProof()
  view().openMenuScreen('reports')
  assert.deepEqual(shown(), ['reports'])
  view().openMenuScreen('work')
  view().openScreen('yolo')
  view().openMenuScreen('work')
  assert.deepEqual(shown(), ['work'], 'from a page under Work, back to Work alone')
  view().openScreen('reports')
  assert.deepEqual(shown(), ['work', 'reports'])
  view().openMenuScreen('reports')
  assert.deepEqual(shown(), ['reports'], 'the same page from the menu starts over too')
})

test('a link from one page to another is a place on the trail, even to a menu page', () => {
  view().openMenuScreen('home')
  view().openScreen('reports')
  assert.deepEqual(shown(), ['home', 'reports'])
})

test('the trail never holds more than six places, and the oldest leave first', () => {
  view().openMenuScreen('work')
  view().openScreen('yolo')
  view().openProject('a')
  view().openReviewFor('r1')
  view().openProofRun('p1')
  view().openAgentCanvas('a1')
  assert.equal(shown().length, MOST_PLACES)
  view().openReviewFor('r2')
  assert.deepEqual(shown(), ['yolo', 'project:a', 'review:r1', 'proof:p1', 'agent:a1', 'review:r2'], 'Work left first')
  view().openProject('b')
  assert.deepEqual(shown(), ['project:a', 'review:r1', 'proof:p1', 'agent:a1', 'review:r2', 'project:b'])
  assert.equal(MOST_PLACES, 6)
})

test('a page that replaces itself keeps the trail: one agent for another, one run for the next', () => {
  view().openMenuScreen('work')
  view().openAgentCanvas('a1')
  view().openAgentCanvas('a2')
  assert.deepEqual(shown(), ['work', 'agent:a2'])
  view().openProofRun('p1')
  view().openProofRun('p2')
  assert.deepEqual(shown(), ['work', 'agent:a2', 'proof:p2'])
})

test('Settings and the pages under it are places on the trail, Settings before a page opened straight away', () => {
  view().openMenuScreen('work')
  view().toggleIntegrations()
  assert.deepEqual(shown(), ['work', 'settings', 'integrations'], 'Command+I from Work')
  view().toggleIntegrations()
  assert.deepEqual(shown(), ['work', 'settings'], 'stepping back up to Settings')
  view().togglePage('skills')
  assert.deepEqual(shown(), ['work', 'settings', 'skills'])
  view().closeSettings()
  assert.deepEqual([view().screen, shown()], ['work', ['work']])
})

test("hobkin's mind shows the place it was opened over, and going on from it keeps the mind on the trail", () => {
  view().openMenuScreen('work')
  view().openScreen('yolo')
  useView.setState({ screen: 'mind', mindReturn: { screen: 'yolo', settingsReturn: null, screenReturn: null, openAgent: null, previewReturn: null } })
  assert.deepEqual(shown(), ['work', 'yolo', 'mind'])
  view().openAgentCanvas('a1')
  assert.deepEqual(shown(), ['work', 'mind', 'agent:a1'])
  view().closeAgentCanvas()
  assert.deepEqual([view().screen, view().mindReturn?.screen], ['mind', 'yolo'], 'back on the mind, with its own way back')
})

test('Escape on a page open only for now goes back one place', () => {
  const context = (screen: KeyContext['screen']): KeyContext => ({
    zone: 'canvas',
    screen,
    screens: [],
    messageEmpty: true,
    inOverlay: false,
    veilOpen: false,
    asking: false,
    outOfMenu: [],
  })
  for (const screen of ['project', 'world', 'yolo', 'proof', 'review', 'agent'] as const) {
    assert.deepEqual(resolveEscape(context(screen), false), { do: 'leave-screen' }, screen)
  }

  walkToTheProof()
  const steps: string[] = []
  for (let left = 0; left < 4; left++) {
    view().leave()
    steps.push(view().screen)
  }
  assert.deepEqual(steps, ['review', 'project', 'yolo', 'work'], 'one place at a time, from the proof back to Work')

  view().openScreen('world')
  view().openAgentCanvas('a1')
  view().leave()
  assert.deepEqual(shown(), ['work', 'world'], 'an agent opened from World goes back to World, not to Work')
  view().leave()
  assert.deepEqual(shown(), ['work'])
})

test('Escape with nothing on the trail goes where each page went before: Work, or a GitHub for now to the screen under it', () => {
  for (const screen of ['project', 'world', 'yolo', 'proof', 'review', 'agent'] as const) {
    useView.setState({ screen, trail: [], project: 'a', openAgent: 'a1', openReview: 'r1' })
    view().leave()
    assert.equal(view().screen, 'work', screen)
  }
  useView.setState({ screen: 'github', trail: [], screenReturn: 'routines' })
  view().leave()
  assert.equal(view().screen, 'routines')
})

test('a menu page reached from nowhere draws no trail, since the menu lights it already', () => {
  const drawn = () => drawnPlaces(shownTrail(view())).map(({ screen, about }) => (about ? `${screen}:${about}` : screen))
  view().openMenuScreen('work')
  assert.deepEqual(drawn(), [], 'Work alone is the lit menu item')
  view().openProject('hobkin-api')
  assert.deepEqual(drawn(), ['work', 'project:hobkin-api'], 'once there is somewhere to go back to, the whole trail shows')
  useView.setState({ screen: 'project', project: 'hobkin-api', trail: [] })
  assert.deepEqual(drawn(), ['project:hobkin-api'], 'a page the menu has no item for still names itself')
  assert.deepEqual(drawnPlaces([{ screen: 'reports' }], ['reports']), [{ screen: 'reports' }], 'a page taken out of the menu still names itself')
})
