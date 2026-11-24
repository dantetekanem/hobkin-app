import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CanvasState } from '#shared/protocol/canvas.ts'
import type { Place } from '../src/features/main-agent/mind.ts'
import { walkScreens, type ScreenId } from '../src/app/screens.ts'
import { canvasGrowth, launchView, pageInsetMove, splitSizes, useView } from '../src/app/view-store.ts'
import { canvasDot, canvasKey, mainPill, placeMove, showingCanvas, splitOwner, windowCanvas } from '../src/features/canvas-panel/rules.ts'
import { withFixturePart } from './integration-fixture.ts'

withFixturePart()

const view = () => useView.getState()
const place = (screen: ScreenId, more: Partial<Place> = {}): Place => ({ screen, settingsReturn: null, screenReturn: null, openAgent: null, previewReturn: null, ...more })
const start = (screen: ScreenId) =>
  useView.setState({ screen, settingsReturn: null, screenReturn: null, openAgent: null, previewReturn: null, trail: [], canvasReturn: null })

const DRAWING: CanvasState = { open: true, url: 'http://127.0.0.1:9/canvas/k?r=1', title: 'Plan', kind: 'drawing', revision: 1 }
const CLOSED: CanvasState = { open: false, url: null, title: null }
const MAIN = ['home', 'reports', 'routines', 'actions', 'work', 'github'] as const

test('opening the main canvas takes the right side there from the right, and closing goes back to Settings as it was', () => {
  start('reports')
  view().toggleSettings()
  view().openCanvasPlace()
  assert.equal(view().screen, 'canvas')
  assert.deepEqual(view().screenMotion, { axis: 'x', direction: 1 }, 'it comes in from the right')
  assert.deepEqual(view().canvasReturn, place('settings', { settingsReturn: 'reports' }), 'the way back is Settings over Reports')

  const back = view().canvasReturn
  view().openCanvasPlace()
  assert.equal(view().canvasReturn, back, 'opening it again on the canvas changes nothing')

  view().closeCanvasPlace()
  assert.deepEqual([view().screen, view().settingsReturn, view().canvasReturn], ['settings', 'reports', null])
  assert.deepEqual(view().screenMotion, { axis: 'x', direction: -1 }, 'it travels back')
})

test("closing goes back to an agent's page as it was", () => {
  start('routines')
  view().previewAgent('hobkin:0123abcd', 1)
  view().openAgentCanvas('hobkin:0123abcd')
  view().openCanvasPlace()
  assert.deepEqual(view().canvasReturn, place('agent', { openAgent: 'hobkin:0123abcd' }))
  view().closeCanvasPlace()
  assert.deepEqual([view().screen, view().openAgent, view().trail.at(-1)?.screen], ['agent', 'hobkin:0123abcd', 'routines'])
  view().closeCanvasPlace()
  assert.equal(view().screen, 'agent', 'closing away from the canvas changes nothing')
  view().closeAgentCanvas()
})

test('the view goes to the canvas when it opens, and never for a redraw, a launch or a right side that covers the chat', () => {
  assert.equal(placeMove({ before: false, now: true, onPlace: false, covered: false }), 'open', 'closed to open')
  assert.equal(placeMove({ before: true, now: true, onPlace: false, covered: false }), null, 'a redraw elsewhere')
  assert.equal(placeMove({ before: true, now: true, onPlace: true, covered: false }), null, 'a redraw on the canvas')
  assert.equal(placeMove({ before: null, now: true, onPlace: false, covered: false }), null, 'found open when the host first says')
  assert.equal(placeMove({ before: false, now: true, onPlace: false, covered: true }), null, 'a review the user is in, or a split')
  assert.equal(placeMove({ before: false, now: null, onPlace: false, covered: false }), null, 'the host has not said')

  // What covers the chat: a review the user is in, and a durable hobkin's split.
  const width = { conversationWidth: 460 }
  assert.ok(canvasGrowth({ screen: 'review', canvasEngaged: true, ...width }) > 0)
  assert.ok(canvasGrowth({ screen: 'agent', canvasEngaged: false, split: true, ...width }) > 0)
  assert.equal(canvasGrowth({ screen: 'review', canvasEngaged: false, ...width }), 0, 'a review the user stepped out of')
  assert.equal(canvasGrowth({ screen: 'agent', canvasEngaged: true, ...width }), 0, 'an agent without a canvas')
})

test('closing returns to the place under the canvas, also when it closed while the window reloaded', () => {
  assert.equal(placeMove({ before: true, now: false, onPlace: true, covered: false }), 'back')
  assert.equal(placeMove({ before: null, now: false, onPlace: true, covered: false }), 'back', 'Command+R on a canvas that has closed since')
  assert.equal(placeMove({ before: true, now: false, onPlace: false, covered: false }), null, 'closed while the user was elsewhere')
  assert.equal(placeMove({ before: null, now: null, onPlace: true, covered: false }), null, 'on the canvas, before the host says')
})

test('another screen leaves the canvas open with its pill, dotted after a redraw not seen, and the pill and its number go back', () => {
  start('reports')
  view().openCanvasPlace()
  view().openScreen('home')
  assert.equal(view().screen, 'home')
  assert.deepEqual(view().screenMotion, { axis: 'x', direction: -1 }, 'the canvas leaves to the right')

  view().seeCanvas('main', 1)
  assert.deepEqual(mainPill({ screen: 'home', split: false, main: DRAWING, seen: view().canvasSeen.main }), { dot: false })
  assert.deepEqual(mainPill({ screen: 'home', split: false, main: { ...DRAWING, revision: 2 }, seen: view().canvasSeen.main }), { dot: true }, 'redrawn since')
  assert.equal(mainPill({ screen: 'canvas', split: false, main: DRAWING, seen: 1 }), null, 'on the canvas the group shows instead')
  assert.equal(mainPill({ screen: 'agent', split: true, main: DRAWING, seen: 1 }), null, "left out while a durable hobkin's split shows")
  assert.equal(mainPill({ screen: 'home', split: false, main: CLOSED, seen: 1 }), null, 'a closed canvas has none')
  assert.equal(mainPill({ screen: 'home', split: false, main: null, seen: 1 }), null, 'nor one the host has not told')

  assert.deepEqual(walkScreens({ screen: 'home', reviewOpen: false, outOfMenu: [], canvasOpen: true }), [...MAIN, 'canvas'])
  assert.deepEqual(walkScreens({ screen: 'settings', reviewOpen: false, outOfMenu: [], canvasOpen: true }), [...MAIN, 'settings', 'canvas'], 'after the other places open now')
  assert.deepEqual(walkScreens({ screen: 'canvas', reviewOpen: false, outOfMenu: [], canvasOpen: true }), [...MAIN, 'canvas'], 'on the canvas itself')
  assert.deepEqual(walkScreens({ screen: 'home', reviewOpen: false, outOfMenu: [], canvasOpen: false }), MAIN, 'closed')
  assert.deepEqual(walkScreens({ screen: 'home', reviewOpen: false, outOfMenu: [] }), MAIN)

  view().openCanvasPlace()
  assert.deepEqual([view().screen, view().canvasReturn], ['canvas', place('home')], 'the pill goes back, with a way back of its own')
  view().closeCanvasPlace()
})

test('a revision counts as seen once, and the dot asks only for a newer one', () => {
  view().seeCanvas('0123abcd', 4)
  assert.equal(view().canvasSeen['0123abcd'], 4)
  assert.equal(canvasDot(4, 4), false)
  assert.equal(canvasDot(5, 4), true)
  assert.equal(canvasDot(1, undefined), true, 'a canvas never seen')
  assert.equal(canvasDot(undefined, undefined), false, 'a host from before revisions')
})

test("the split's sizes: the right side grows by the chat and the divider, the page takes the chat's width, the canvas the rest", () => {
  assert.deepEqual(splitSizes(1440, 460), { grow: 470, pageWidth: 470, canvasWidth: 970 })
  assert.deepEqual(splitSizes(400, 460), { grow: 470, pageWidth: 470, canvasWidth: 0 }, 'never below nothing')
  assert.equal(canvasGrowth({ screen: 'agent', canvasEngaged: false, conversationWidth: 460, split: true }), splitSizes(1440, 460).grow)
})

test("the split shows on a durable hobkin's page while its canvas is open, and the canvas on screen knows its agent", () => {
  const canvases: Record<string, CanvasState> = { '0123abcd': DRAWING, main: DRAWING }
  const canvasOf = (owner: string) => canvases[owner] ?? null
  const page = { screen: 'agent' as const, openAgent: 'hobkin:0123abcd' }
  assert.equal(splitOwner(page, canvasOf), '0123abcd')
  assert.equal(splitOwner({ ...page, openAgent: 'job-1' }, canvasOf), null, 'not a durable hobkin')
  assert.equal(splitOwner({ screen: 'work', openAgent: 'hobkin:0123abcd' }, canvasOf), null, 'away from its page')
  assert.equal(splitOwner(page, (owner) => (owner === '0123abcd' ? CLOSED : DRAWING)), null, 'its canvas closed')

  assert.deepEqual(showingCanvas(page, canvasOf), { owner: '0123abcd', agent: 'talk' })
  assert.deepEqual(showingCanvas({ screen: 'canvas', openAgent: null }, canvasOf), { owner: 'main', agent: 'input' })
  assert.equal(showingCanvas({ screen: 'canvas', openAgent: null }, () => CLOSED), null)
  assert.equal(showingCanvas({ screen: 'home', openAgent: null }, canvasOf), null, 'a pill is not a canvas on screen')
})

test('the window shows what the host says, a canvas closed here reads closed until the host says more, and the dev helper shows one by hand', () => {
  assert.equal(windowCanvas(null, {}), null, 'nothing known yet')
  assert.equal(windowCanvas(DRAWING, {}), DRAWING)
  assert.equal(windowCanvas(DRAWING, { closed: canvasKey(DRAWING) })?.open, false, 'closed at once, before the host answers')
  assert.equal(windowCanvas({ ...DRAWING, revision: 2 }, { closed: canvasKey(DRAWING) })?.open, true, 'hobkin drew again')

  const byHand: CanvasState = { open: true, url: 'https://dev.invalid/', title: null }
  assert.equal(windowCanvas(null, { dev: { canvas: byHand, over: canvasKey(null) } }), byHand, 'without a host')
  assert.equal(windowCanvas(CLOSED, { dev: { canvas: byHand, over: canvasKey(CLOSED) } }), byHand, 'over what the host said')
  assert.equal(windowCanvas(DRAWING, { dev: { canvas: byHand, over: canvasKey(CLOSED) } }), DRAWING, 'until the host says something new')
})

test('a new launch comes back on the place under the canvas, and keeps what was seen', () => {
  const saved = (state: Partial<ReturnType<typeof view>>) => launchView({ ...view(), ...state })
  assert.equal(saved({ screen: 'canvas', canvasReturn: place('settings', { settingsReturn: 'reports' }) }).screen, 'reports')
  const agent = saved({ screen: 'canvas', openAgent: 'job-1', canvasReturn: place('agent', { openAgent: 'hobkin:0123abcd' }) })
  assert.deepEqual([agent.screen, agent.openAgent], ['agent', 'hobkin:0123abcd'])
  assert.equal(saved({ screen: 'settings', settingsReturn: 'canvas', canvasReturn: place('home') }).screen, 'home', 'Settings over the canvas')
  assert.equal(saved({ screen: 'canvas', canvasReturn: null }).screen, 'work', 'a canvas with no way back')
  assert.deepEqual(saved({ screen: 'home', canvasSeen: { main: 3 } }).canvasSeen, { main: 3 })
})

test("a hobkin's page narrows beside its sketch, and a draw puts it right when it was missed", () => {
  const at = { onPage: true, wasOnPage: true, split: true, wasSplit: false, sent: 0, canvasWidth: 400, still: false }
  assert.equal(pageInsetMove(at), 'travel', 'the split forming on the page travels')
  assert.equal(pageInsetMove({ ...at, split: false, wasSplit: true, sent: 400 }), 'travel', 'the split undoing travels')
  assert.equal(pageInsetMove({ ...at, wasSplit: true, sent: 400 }), 'leave', 'a draw that finds it in place leaves it')
  assert.equal(pageInsetMove({ ...at, wasSplit: true, sent: 0 }), 'jump', 'a split shown with the page still wide is put right at once')
  assert.equal(pageInsetMove({ ...at, wasSplit: true, sent: 300 }), 'jump', 'a resize puts it straight there')
  assert.equal(pageInsetMove({ ...at, wasOnPage: false }), 'jump', 'arriving on the page')
  assert.equal(pageInsetMove({ ...at, still: true }), 'jump', 'Still')
  assert.equal(pageInsetMove({ ...at, onPage: false }), 'leave', 'a page on its way out keeps its width')
})
