import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveEscape, resolveKey, type KeyContext } from '../src/app/key-map.ts'

const MENU = ['work', 'routines', 'reports', 'actions', 'pages'] as const

function context(overrides: Partial<KeyContext> = {}): KeyContext {
  return { zone: 'input', messageEmpty: true, screens: MENU, screen: 'work', inOverlay: false, veilOpen: false, asking: false, ...overrides }
}

test('tab walks the menu and wraps', () => {
  assert.deepEqual(resolveKey({ key: 'Tab' }, context()), { do: 'open-screen', screen: 'routines', focusCanvas: false })
  assert.deepEqual(resolveKey({ key: 'Tab', shift: true }, context({ screen: 'routines' })), { do: 'open-screen', screen: 'work', focusCanvas: false })

  assert.deepEqual(resolveKey({ key: 'Tab' }, context({ screen: 'pages' })), { do: 'open-screen', screen: 'work', focusCanvas: false }, 'wraps forward')
  assert.deepEqual(resolveKey({ key: 'Tab', shift: true }, context()), { do: 'open-screen', screen: 'pages', focusCanvas: false }, 'wraps backward')
})

test('tab changes the screen from anywhere, with or without text in the message', () => {
  assert.deepEqual(resolveKey({ key: 'Tab' }, context({ messageEmpty: false })), { do: 'open-screen', screen: 'routines', focusCanvas: false })

  for (const zone of ['input', 'veil', 'other'] as const) {
    assert.deepEqual(resolveKey({ key: 'Tab' }, context({ zone })), { do: 'open-screen', screen: 'routines', focusCanvas: false }, zone)
    assert.deepEqual(resolveKey({ key: 'Tab', shift: true }, context({ zone })), { do: 'open-screen', screen: 'pages', focusCanvas: false }, `Shift+Tab in ${zone}`)
  }
})

test('tab from inside the canvas keeps the keyboard in the canvas', () => {
  // The control that had the keyboard leaves with its screen, so the new screen takes it.
  assert.deepEqual(resolveKey({ key: 'Tab' }, context({ zone: 'canvas' })), { do: 'open-screen', screen: 'routines', focusCanvas: true })
})

test('tab includes a screen that is open only for now, such as a review', () => {
  const screens = [...MENU, 'review'] as const

  assert.deepEqual(resolveKey({ key: 'Tab' }, context({ screens, screen: 'pages' })), { do: 'open-screen', screen: 'review', focusCanvas: false })
  assert.deepEqual(resolveKey({ key: 'Tab' }, context({ screens, screen: 'review' })), { do: 'open-screen', screen: 'work', focusCanvas: false })
})

test('among the agents tab is held, and it is the menu\'s again once the keyboard has left them', () => {
  for (const shift of [false, true]) {
    assert.deepEqual(resolveKey({ key: 'Tab', shift }, context({ zone: 'agents', screen: 'agent', under: 'work' })), { do: 'hold' }, 'in the agents list')
    assert.deepEqual(resolveKey({ key: 'Tab', shift }, context({ zone: 'canvas', screen: 'agent', under: 'work' })), { do: 'hold' }, 'talking to an agent')
  }

  // Back in the message input with an agent still on the canvas, Tab counts from the screen under it.
  assert.deepEqual(resolveKey({ key: 'Tab' }, context({ zone: 'input', screen: 'agent', under: 'work' })), { do: 'open-screen', screen: 'routines', focusCanvas: false })
  assert.deepEqual(resolveKey({ key: 'Tab', shift: true }, context({ zone: 'input', screen: 'agent', under: 'routines' })), { do: 'open-screen', screen: 'work', focusCanvas: false })
})

test('left and right never change the screen', () => {
  for (const key of ['ArrowLeft', 'ArrowRight']) {
    assert.equal(resolveKey({ key }, context()), null, `${key} on an empty message`)
    assert.equal(resolveKey({ key }, context({ messageEmpty: false })), null, `${key} with text`)
    assert.equal(resolveKey({ key, shift: true }, context()), null, `Shift+${key}`)
  }
})

test('down enters the agents only when the message is empty', () => {
  assert.deepEqual(resolveKey({ key: 'ArrowDown' }, context()), { do: 'focus-agents' })

  assert.equal(resolveKey({ key: 'ArrowDown' }, context({ messageEmpty: false })), null, 'with text it moves the caret')
  assert.equal(resolveKey({ key: 'ArrowDown', shift: true }, context()), null, 'Shift+Down selects text')
  assert.equal(resolveKey({ key: 'ArrowDown' }, context({ zone: 'canvas' })), null, 'only from the message input')
})

test('command keys open a screen, enter the canvas and return home', () => {
  assert.deepEqual(resolveKey({ key: '2', meta: true }, context()), { do: 'open-screen', screen: 'routines', focusCanvas: true })
  assert.deepEqual(resolveKey({ key: '5', meta: true }, context({ zone: 'canvas' })), { do: 'open-screen', screen: 'pages', focusCanvas: true })
  assert.equal(resolveKey({ key: '9', meta: true }, context()), null, 'no ninth screen in the menu')

  assert.deepEqual(resolveKey({ key: 'j', meta: true }, context()), { do: 'focus-canvas' })
  assert.deepEqual(resolveKey({ key: 'l', meta: true }, context({ zone: 'canvas' })), { do: 'focus-input' })
  assert.deepEqual(resolveKey({ key: 'p', meta: true }, context()), { do: 'open-veil', section: 'projects' })
  assert.deepEqual(resolveKey({ key: 'y', meta: true }, context({ zone: 'veil' })), { do: 'open-veil', section: 'history' })
})

test('command comma opens settings from anywhere', () => {
  for (const zone of ['input', 'agents', 'veil', 'canvas', 'other'] as const) {
    assert.deepEqual(resolveKey({ key: ',', meta: true }, context({ zone })), { do: 'open-settings' }, zone)
  }
  assert.equal(resolveKey({ key: ',', meta: true }, context({ inOverlay: true })), null, 'not while a dialog has the keyboard')
})

test('command i opens integrations from anywhere', () => {
  for (const zone of ['input', 'agents', 'veil', 'canvas', 'other'] as const) {
    assert.deepEqual(resolveKey({ key: 'i', meta: true }, context({ zone })), { do: 'open-integrations' }, zone)
  }
})

test('command keys with another modifier belong to something else', () => {
  assert.equal(resolveKey({ key: 'p', meta: true, shift: true }, context()), null)
  assert.equal(resolveKey({ key: 'p', meta: true, alt: true }, context()), null)
  assert.equal(resolveKey({ key: 'p', ctrl: true, alt: true }, context()), null, 'Ctrl+Option+P is the prompt editor, owned by the chat')
  assert.equal(resolveKey({ key: 'Tab', ctrl: true }, context()), null)
})

test('a dialog or menu that owns the keyboard keeps every key', () => {
  assert.equal(resolveKey({ key: 'Tab' }, context({ inOverlay: true })), null)
  assert.equal(resolveKey({ key: '1', meta: true }, context({ inOverlay: true })), null)
  assert.equal(resolveEscape(context({ zone: 'other', inOverlay: true }), false), null)
})

test('with the veil open, the arrows walk its list, enter chooses and escape closes, wherever the keyboard is', () => {
  for (const zone of ['input', 'agents', 'veil', 'canvas', 'other'] as const) {
    for (const messageEmpty of [true, false]) {
      const open = context({ zone, messageEmpty, veilOpen: true })
      assert.deepEqual(resolveKey({ key: 'ArrowDown' }, open), { do: 'veil-move', delta: 1 }, zone)
      assert.deepEqual(resolveKey({ key: 'ArrowUp' }, open), { do: 'veil-move', delta: -1 }, zone)
      assert.deepEqual(resolveKey({ key: 'ArrowRight' }, open), { do: 'veil-switch', delta: 1 }, zone)
      assert.deepEqual(resolveKey({ key: 'ArrowLeft' }, open), { do: 'veil-switch', delta: -1 }, zone)
      assert.deepEqual(resolveKey({ key: 'Enter' }, open), { do: 'veil-choose' }, zone)
      assert.deepEqual(resolveKey({ key: 'Escape' }, open), { do: 'close-veil' }, zone)
    }
  }
})

test('with the veil open, tab still changes the screen and other keys still type', () => {
  const open = context({ veilOpen: true })
  assert.deepEqual(resolveKey({ key: 'Tab' }, open), { do: 'open-screen', screen: 'routines', focusCanvas: false })
  assert.equal(resolveKey({ key: 'a' }, open), null)
  assert.equal(resolveKey({ key: 'Enter', shift: true }, open), null, 'Shift+Enter is a new line in the message')
})

test('with the veil closed, enter and escape are not taken before the page sees them', () => {
  assert.equal(resolveKey({ key: 'Enter' }, context()), null, 'Enter sends the message')
  assert.equal(resolveKey({ key: 'Escape' }, context()), null, 'Escape is read last, after whatever has the keyboard')
  assert.equal(resolveKey({ key: 'ArrowUp' }, context()), null)
})

test('a dialog over the veil keeps the keys', () => {
  assert.equal(resolveKey({ key: 'ArrowDown' }, context({ veilOpen: true, inOverlay: true })), null)
})

test('escape walks back to the message input from anywhere else', () => {
  for (const zone of ['agents', 'veil', 'canvas', 'other'] as const) {
    assert.deepEqual(resolveEscape(context({ zone }), false), { do: 'focus-input' }, zone)
  }
  assert.equal(resolveEscape(context({ zone: 'input' }), false), null, 'already home')
})

test('a prevented key is left alone', () => {
  assert.equal(resolveEscape(context({ zone: 'canvas' }), true), null, 'a screen that used Escape keeps it')
})

test('command g goes to an agent that is waiting for the user, and is left alone when none is', () => {
  assert.deepEqual(resolveKey({ key: 'g', meta: true }, context({ asking: true })), { do: 'answer-agent' })
  assert.deepEqual(resolveKey({ key: 'g', meta: true }, context({ asking: true, zone: 'canvas' })), { do: 'answer-agent' }, 'from anywhere')

  assert.equal(resolveKey({ key: 'g', meta: true }, context()), null, 'nobody is waiting')
  assert.equal(resolveKey({ key: 'g', meta: true }, context({ asking: true, inOverlay: true })), null, 'a dialog keeps the key')
  assert.equal(resolveKey({ key: 'u', meta: true }, context({ asking: true })), null, 'command u stays the message input\'s')
})

test('command r reloads the window from anywhere, also from a dialog', () => {
  assert.deepEqual(resolveKey({ key: 'r', meta: true }, context()), { do: 'reload' })
  assert.deepEqual(resolveKey({ key: 'r', meta: true }, context({ zone: 'canvas', inOverlay: true })), { do: 'reload' })
  assert.deepEqual(resolveKey({ key: 'R', meta: true, shift: true }, context()), { do: 'reload' }, 'with Shift too, as in a browser')
  assert.equal(resolveKey({ key: 'r', meta: true, alt: true }, context()), null, 'command option r belongs to something else')
})

test('escape that nothing used leaves a screen that is open only for now', () => {
  for (const screen of ['review', 'settings', 'integrations', 'github'] as const) {
    assert.deepEqual(resolveEscape(context({ zone: 'canvas', screen }), false), { do: 'leave-screen' }, screen)
    assert.deepEqual(resolveEscape(context({ zone: 'other', screen }), false), { do: 'leave-screen' }, `${screen}, with the keyboard nowhere`)
    assert.equal(resolveEscape(context({ zone: 'canvas', screen }), true), null, `${screen}, when the screen used the key`)
    assert.equal(resolveEscape(context({ zone: 'input', screen }), false), null, `${screen}, from the message input`)
  }

  assert.deepEqual(resolveEscape(context({ zone: 'canvas', screen: 'work' }), false), { do: 'focus-input' }, 'a menu screen stays open')
})
