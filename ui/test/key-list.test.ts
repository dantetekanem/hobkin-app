import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HINT_KEYS, KEY_LIST, navigationGuide } from '../src/app/key-list.ts'
import { resolveEscape, resolveKey, type KeyContext } from '../src/app/key-map.ts'
import { screens, inMenu } from '../src/app/screens.ts'
import { withFixturePart } from './integration-fixture.ts'

withFixturePart()

const MENU = screens().filter(({ id }) => inMenu(id)).map(({ id }) => id)
const context: KeyContext = { zone: 'input', messageEmpty: true, screens: MENU, screen: 'work', inOverlay: false, veilOpen: false, asking: true, outOfMenu: [] }

test('numbered commands resolve only within the current menu', () => {
  assert.equal(resolveKey({ key: String(MENU.length), meta: true }, context)?.do, 'open-screen')
  assert.equal(resolveKey({ key: String(MENU.length + 1), meta: true }, context), null)
})

test('each frame key in the list resolves in the key map', () => {
  const press: [string, Parameters<typeof resolveKey>[0]][] = [
    ['⌘K', { key: 'k', meta: true }],
    ['⌘N', { key: 'n', meta: true }],
    ['⌘Y', { key: 'y', meta: true }],
    ['⌘,', { key: ',', meta: true }],
    ['⌘I', { key: 'i', meta: true }],
    ['⌘J', { key: 'j', code: 'KeyJ', meta: true }],
    ['⌘G', { key: 'g', meta: true }],
    ['⌃⌥P', { key: 'π', code: 'KeyP', ctrl: true, alt: true }],
    ['⌃⌥S', { key: 'ß', code: 'KeyS', ctrl: true, alt: true }],
    ['↓', { key: 'ArrowDown' }],
  ]
  for (const [keys, event] of press) {
    assert.ok(KEY_LIST.some((entry) => entry.keys === keys), `${keys} is listed`)
    assert.ok(resolveKey(event, context), `${keys} does something`)
  }
  assert.equal(resolveKey({ key: 'Tab' }, context), null, 'tab is never the frame\'s')
  assert.ok(KEY_LIST.some((entry) => entry.keys === '⌃O'), '⌃O is listed')
  assert.ok(resolveKey({ key: 'o', code: 'KeyO', ctrl: true }, { ...context, screen: 'agent' }), "⌃O does something on an agent's screen")
  assert.ok(KEY_LIST.some((entry) => entry.keys === '⌃X'), '⌃X is listed')
  assert.ok(resolveKey({ key: 'x', code: 'KeyX', ctrl: true }, { ...context, screen: 'agent', hobkinPage: true, zone: 'canvas' }), "⌃X does something on a durable hobkin's page")
  assert.ok(resolveKey({ key: 'x', code: 'KeyX', ctrl: true }, { ...context, screen: 'agent', zone: 'canvas' }), "⌃X does something on any other agent's page")
})

test('the canvas keys are listed for the canvas, and each does something there', () => {
  const inCanvas: KeyContext = { ...context, zone: 'canvas', screen: 'canvas', board: { owner: 'main', kind: 'drawing' }, canvasShowing: { owner: 'main', agent: 'input' } }
  for (const keys of ['esc', '⌘S']) {
    assert.ok(KEY_LIST.some((entry) => entry.keys === keys && !entry.basic && entry.where.includes('canvas')), `${keys} is listed for the canvas`)
  }
  assert.ok(resolveEscape(inCanvas, false), 'esc does something in the canvas')
  assert.ok(resolveKey({ key: 's', code: 'KeyS', meta: true }, inCanvas), '⌘S does something on a drawing')
})

test('the hints are in the list and the walkthrough names every key', () => {
  assert.ok(HINT_KEYS.every((hint) => KEY_LIST.includes(hint)))
  const guide = navigationGuide()
  for (const { keys } of KEY_LIST) assert.ok(guide.includes(keys))
})
