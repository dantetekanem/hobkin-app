import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HINT_KEYS, KEY_LIST, navigationGuide } from '../src/app/key-list.ts'
import { resolveKey, type KeyContext } from '../src/app/key-map.ts'
import { SCREENS, inMenu } from '../src/app/screens.ts'

const MENU = SCREENS.filter(({ id }) => inMenu(id, true)).map(({ id }) => id)
const context: KeyContext = { zone: 'input', messageEmpty: true, screens: MENU, screen: 'work', inOverlay: false, veilOpen: false, asking: true, githubInMenu: true }

test('numbered commands resolve only within the current menu', () => {
  assert.equal(resolveKey({ key: String(MENU.length), meta: true }, context)?.do, 'open-screen')
  assert.equal(resolveKey({ key: String(MENU.length + 1), meta: true }, context), null)
})

test('each frame key in the list resolves in the key map', () => {
  const press: [string, Parameters<typeof resolveKey>[0]][] = [
    ['⌘K', { key: 'k', meta: true }],
    ['⌘Y', { key: 'y', meta: true }],
    ['⌘,', { key: ',', meta: true }],
    ['⌘I', { key: 'i', meta: true }],
    ['⌘J', { key: 'j', code: 'KeyJ', meta: true }],
    ['⌘G', { key: 'g', meta: true }],
    ['⌃⌥P', { key: 'π', code: 'KeyP', ctrl: true, alt: true }],
    ['↓', { key: 'ArrowDown' }],
  ]
  for (const [keys, event] of press) {
    assert.ok(KEY_LIST.some((entry) => entry.keys === keys), `${keys} is listed`)
    assert.ok(resolveKey(event, context), `${keys} does something`)
  }
  assert.equal(resolveKey({ key: 'Tab' }, context), null, 'tab is never the frame\'s')
})

test('the hints are in the list and the walkthrough names every key', () => {
  assert.ok(HINT_KEYS.every((hint) => KEY_LIST.includes(hint)))
  const guide = navigationGuide()
  for (const { keys } of KEY_LIST) assert.ok(guide.includes(keys))
})
