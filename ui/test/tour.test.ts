import assert from 'node:assert/strict'
import { test } from 'node:test'
import { KEY_LIST } from '../src/app/key-list.ts'
import { resolveKey, type KeyContext } from '../src/app/key-map.ts'
import { startTour, stepTour, type Tour, type TourEvent } from '../src/features/tour/flow.ts'
import { resolveTourKey } from '../src/features/tour/keys.ts'
import { holeOf, holePolygon, placeCard, type Box, type Size } from '../src/features/tour/place.ts'
import { TOUR_STEPS } from '../src/features/tour/steps.ts'

const run = (events: TourEvent[], from: Tour = startTour()) => events.reduce(stepTour, from)
const LAST = TOUR_STEPS.length - 1
const toLast = (): TourEvent[] => Array.from({ length: LAST }, () => 'next')

test('the tour starts at the first stop, and next goes on one stop at a time', () => {
  assert.deepEqual(startTour(), { at: 0, direction: 1, ended: null })
  assert.deepEqual(run(['next']), { at: 1, direction: 1, ended: null })
  assert.equal(run(['next', 'next']).at, 2)
})

test('next from the last stop ends the tour as done', () => {
  const atLast = run(toLast())
  assert.equal(atLast.at, LAST)
  assert.equal(atLast.ended, null)
  assert.deepEqual(stepTour(atLast, 'next'), { at: LAST, direction: 1, ended: 'done' })
})

test('back goes one stop back, and the first stop has nothing behind it', () => {
  const back = run(['next', 'next', 'back'])
  assert.equal(back.at, 1)
  assert.equal(back.direction, -1)
  assert.deepEqual(run(['back']), startTour())
})

test('end ends the tour from any stop, as left', () => {
  assert.equal(run(['end']).ended, 'left')
  assert.equal(run(['next', 'next', 'end']).ended, 'left')
  assert.equal(run([...toLast(), 'end']).ended, 'left')
})

test('nothing moves once the tour has ended', () => {
  const over = run(['next', 'end'])
  for (const event of ['next', 'back', 'end'] as const) assert.deepEqual(stepTour(over, event), over)
})

test('Enter, Right and Space go on, Left goes back, Escape ends it', () => {
  assert.equal(resolveTourKey({ key: 'Enter' }), 'next')
  assert.equal(resolveTourKey({ key: 'ArrowRight' }), 'next')
  assert.equal(resolveTourKey({ key: ' ' }), 'next')
  assert.equal(resolveTourKey({ key: 'ArrowLeft' }), 'back')
  assert.equal(resolveTourKey({ key: 'Escape' }), 'end')
})

test('keys held with Command, Control or Option are not the tour\'s', () => {
  for (const key of ['Enter', 'ArrowRight', ' ', 'ArrowLeft', 'Escape']) {
    assert.equal(resolveTourKey({ key, meta: true }), null, `meta ${key}`)
    assert.equal(resolveTourKey({ key, ctrl: true }), null, `ctrl ${key}`)
    assert.equal(resolveTourKey({ key, alt: true }), null, `alt ${key}`)
  }
})

test('Tab and other keys keep their usual meaning', () => {
  assert.equal(resolveTourKey({ key: 'Tab' }), null)
  assert.equal(resolveTourKey({ key: 'Tab', shift: true }), null)
  assert.equal(resolveTourKey({ key: 'a' }), null)
})

test('a button that has the keyboard keeps Enter and Space, which press it', () => {
  assert.equal(resolveTourKey({ key: 'Enter' }, { pressable: true }), null)
  assert.equal(resolveTourKey({ key: ' ' }, { pressable: true }), null)
  assert.equal(resolveTourKey({ key: 'ArrowRight' }, { pressable: true }), 'next')
  assert.equal(resolveTourKey({ key: 'Escape' }, { pressable: true }), 'end')
})

const WINDOWS: Size[] = [
  { width: 900, height: 600 },
  { width: 1728, height: 1117 },
]
const CARD: Size = { width: 320, height: 190 }

/** Boxes that look like the tour's real targets in a window. */
function targetsIn(win: Size): Record<string, Box> {
  const chat = Math.round(win.width * 0.34)
  return {
    chatColumn: { left: 0, top: 0, width: chat, height: win.height },
    face: { left: 14, top: win.height - 66, width: 44, height: 44 },
    menu: { left: win.width / 2 - 190, top: 14, width: 380, height: 40 },
    homeButton: { left: win.width / 2 - 180, top: 18, width: 56, height: 32 },
    workButton: { left: win.width / 2 + 40, top: 18, width: 56, height: 32 },
  }
}

const inside = (box: Box, win: Size) =>
  box.left >= 0 && box.top >= 0 && box.left + box.width <= win.width && box.top + box.height <= win.height
const overlaps = (a: Box, b: Box) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height

test('the card stays wholly inside the window, with a margin, and never covers the hole', () => {
  for (const win of WINDOWS) {
    for (const [name, target] of Object.entries(targetsIn(win))) {
      const spot = placeCard(target, CARD, win)
      const card: Box = { ...spot, ...CARD }
      const hole = holeOf(target, win)
      assert.ok(inside(card, win), `${name} in ${win.width}x${win.height}: inside`)
      assert.ok(spot.left >= 12 && spot.top >= 12, `${name}: margin`)
      assert.ok(spot.left + CARD.width <= win.width - 12 && spot.top + CARD.height <= win.height - 12, `${name}: far margin`)
      assert.ok(!overlaps(card, hole!), `${name} in ${win.width}x${win.height}: clear of the hole`)
    }
  }
})

test('the card sits below the menu, right of the chat column and above the face by the input', () => {
  for (const win of WINDOWS) {
    const { menu, chatColumn, face } = targetsIn(win)
    assert.ok(placeCard(menu!, CARD, win).top >= menu!.top + menu!.height, 'below the menu')
    assert.ok(placeCard(chatColumn!, CARD, win).left >= chatColumn!.left + chatColumn!.width, 'right of the chat column')
    assert.ok(placeCard(face!, CARD, win).top + CARD.height <= face!.top, 'above the face')
  }
})

test('with no target the card is in the middle, and there is no hole', () => {
  for (const win of WINDOWS) {
    const spot = placeCard(null, CARD, win)
    assert.equal(spot.left, (win.width - CARD.width) / 2)
    assert.equal(spot.top, (win.height - CARD.height) / 2)
    assert.equal(holeOf(null, win), null)
  }
})

test('the hole is the target grown a little, and clamped to the window', () => {
  const win = WINDOWS[0]!
  const hole = holeOf({ left: 100, top: 100, width: 50, height: 40 }, win)!
  assert.ok(hole.left < 100 && hole.top < 100)
  assert.ok(hole.left + hole.width > 150 && hole.top + hole.height > 140)
  assert.ok(hole.radius > 0)

  const flush = holeOf({ left: 0, top: 0, width: 400, height: win.height }, win)!
  assert.ok(inside(flush, win))
  assert.equal(flush.left, 0)
  assert.equal(flush.top, 0)
})

test('the hole polygon has the same shape for every hole, so it can glide between them', () => {
  const win = WINDOWS[0]!
  const shapes = [holeOf(targetsIn(win).menu!, win), holeOf(targetsIn(win).chatColumn!, win), null].map((hole) => holePolygon(hole, win))
  const template = (text: string) => text.replace(/-?\d+(\.\d+)?/g, '#')
  assert.equal(new Set(shapes.map(template)).size, 1)
  assert.match(shapes[0]!, /^polygon\(evenodd, /)
})

test('every stop has a unique id and words', () => {
  assert.equal(new Set(TOUR_STEPS.map((step) => step.id)).size, TOUR_STEPS.length)
  for (const step of TOUR_STEPS) {
    assert.ok(step.title.trim().length > 0, `${step.id} title`)
    assert.ok(step.text.trim().length > 0, `${step.id} text`)
  }
})

test('every key a stop shows is a key the app binds', () => {
  const listed = new Set(KEY_LIST.flatMap((entry) => entry.keys.split(/,?\s+/).filter(Boolean)))
  const context: KeyContext = {
    zone: 'input',
    messageEmpty: true,
    screens: ['home', 'reports', 'routines', 'actions', 'work'],
    screen: 'home',
    inOverlay: false,
    veilOpen: false,
    asking: false,
    githubInMenu: true,
  }
  const press = { j: { key: 'j', code: 'KeyJ' }, ',': { key: ',', code: 'Comma' }, k: { key: 'k', code: 'KeyK' } } as const

  for (const step of TOUR_STEPS) {
    if (!step.kbd) continue
    assert.ok(listed.has(step.kbd), `${step.id}: ${step.kbd} is in the app's key list`)
    const letter = step.kbd.replace('⌘', '').toLowerCase() as keyof typeof press
    assert.ok(resolveKey({ ...press[letter], meta: true }, context), `${step.id}: ${step.kbd} does something in the key map`)
  }
})
