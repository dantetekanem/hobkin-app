import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveEscape, resolveKey, type KeyContext } from '../src/app/key-map.ts'
import { walkScreens } from '../src/app/screens.ts'

const MENU = ['work', 'routines', 'reports', 'actions', 'github'] as const

function context(overrides: Partial<KeyContext> = {}): KeyContext {
  return { zone: 'input', messageEmpty: true, screens: MENU, screen: 'work', inOverlay: false, veilOpen: false, asking: false, githubInMenu: true, ...overrides }
}

test('the numbered screens hold github unless the menu leaves it out, and then only while it is open', () => {
  const MAIN = ['reports', 'routines', 'actions', 'work'] as const
  assert.deepEqual(walkScreens({ screen: 'work', reviewOpen: false, githubInMenu: true }), [...MAIN, 'github'])
  assert.deepEqual(walkScreens({ screen: 'work', reviewOpen: false, githubInMenu: false }), MAIN, 'taken out of the menu')
  assert.deepEqual(walkScreens({ screen: 'github', reviewOpen: false, githubInMenu: false }), [...MAIN, 'github'], 'opened anyway')
  assert.deepEqual(walkScreens({ screen: 'settings', reviewOpen: true, githubInMenu: true }), [...MAIN, 'github', 'review', 'settings'], 'what is open only for now comes after')
})

test('control option p opens the full prompt from every screen, known by the key where P sits', () => {
  // Option changes the character a key types on a Mac, so the press is matched by its code.
  const press = { key: 'π', code: 'KeyP', ctrl: true, alt: true }
  for (const screen of ['reports', 'work', 'review', 'agent'] as const) {
    for (const zone of ['input', 'agents', 'veil', 'canvas', 'other'] as const) {
      assert.deepEqual(resolveKey(press, context({ screen, zone, messageEmpty: false })), { do: 'open-prompt' }, `${zone} on ${screen}`)
    }
  }
  assert.deepEqual(resolveKey({ ...press, key: 'p' }, context()), { do: 'open-prompt' }, 'whatever character it types')
  assert.deepEqual(resolveKey(press, context({ zone: 'canvas', inOverlay: true })), { do: 'open-prompt' }, 'a panel of the screen, such as a routine detail')

  assert.equal(resolveKey(press, context({ zone: 'other', inOverlay: true })), null, 'a dialog over the window, the editor itself among them, keeps it')
  assert.equal(resolveKey(press, context({ zone: 'input', inOverlay: true })), null, 'while completions own the message input, the input opens the editor itself')
  for (const other of [{ ctrl: false }, { alt: false }, { meta: true }, { shift: true }, { code: 'KeyO' }]) {
    assert.equal(resolveKey({ ...press, ...other }, context()), null, JSON.stringify(other))
  }
})

test("command j opens and closes hobkin's mind from every screen, known by the key where J sits", () => {
  const press = { key: 'j', code: 'KeyJ', meta: true }
  for (const screen of ['reports', 'work', 'agent', 'review', 'settings', 'mind'] as const) {
    for (const zone of ['input', 'agents', 'veil', 'canvas', 'other'] as const) {
      assert.deepEqual(resolveKey(press, context({ screen, zone, messageEmpty: false })), { do: 'toggle-mind' }, `${zone} on ${screen}`)
    }
  }
  assert.deepEqual(resolveKey(press, context({ zone: 'canvas', inOverlay: true })), { do: 'toggle-mind' }, 'a panel of the screen')
  assert.equal(resolveKey(press, context({ zone: 'other', inOverlay: true })), null, 'a dialog over the window keeps it')
  for (const other of [{ meta: false }, { ctrl: true }, { alt: true }, { shift: true }, { code: 'KeyK' }]) {
    assert.notDeepEqual(resolveKey({ ...press, ...other }, context()), { do: 'toggle-mind' }, JSON.stringify(other))
  }
})

test('command enter goes to the message input from anywhere, and leaves the key to the input and to overlays', () => {
  const press = { key: 'Enter', code: 'Enter', meta: true }
  for (const screen of ['reports', 'work', 'agent', 'review', 'mind'] as const) {
    for (const zone of ['agents', 'veil', 'canvas', 'other'] as const) {
      assert.deepEqual(resolveKey(press, context({ screen, zone, messageEmpty: false })), { do: 'focus-input' }, `${zone} on ${screen}`)
    }
  }
  assert.equal(resolveKey(press, context({ zone: 'input', messageEmpty: false })), null, 'the composer keeps it')
  assert.equal(resolveKey(press, context({ zone: 'canvas', inOverlay: true })), null, 'the full prompt sends with it, and the models lightbox applies')
  for (const other of [{ shift: true }, { alt: true }, { ctrl: true }]) {
    assert.equal(resolveKey({ ...press, ...other }, context({ zone: 'canvas' })), null, JSON.stringify(other))
  }
})

test('escape leaves the mind for where the user was, unless something used it', () => {
  for (const zone of ['input', 'agents', 'canvas', 'other'] as const) {
    assert.deepEqual(resolveEscape(context({ screen: 'mind', zone }), false), { do: 'toggle-mind' }, zone)
  }
  assert.equal(resolveEscape(context({ screen: 'mind', zone: 'canvas' }), true), null)
  assert.equal(resolveEscape(context({ screen: 'mind', zone: 'other', inOverlay: true }), false), null)
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

test('command keys open a screen with the keyboard in it, and return home', () => {
  assert.deepEqual(resolveKey({ key: '2', meta: true }, context()), { do: 'open-screen', screen: 'routines', focusCanvas: true })
  assert.deepEqual(resolveKey({ key: '5', meta: true }, context({ zone: 'canvas' })), { do: 'open-screen', screen: 'github', focusCanvas: true })
  assert.equal(resolveKey({ key: '9', meta: true }, context()), null, 'no ninth screen in the menu')

  assert.deepEqual(resolveKey({ key: 'l', meta: true }, context({ zone: 'canvas' })), { do: 'focus-input' })
  assert.deepEqual(resolveKey({ key: 'y', meta: true }, context({ zone: 'veil' })), { do: 'open-veil', section: 'history' })
})

test('command k opens the spotlight from anywhere, and a dialog keeps it', () => {
  for (const zone of ['input', 'agents', 'veil', 'canvas', 'other'] as const) {
    assert.deepEqual(resolveKey({ key: 'k', meta: true }, context({ zone })), { do: 'open-spotlight' }, zone)
  }
  assert.deepEqual(resolveKey({ key: 'k', meta: true }, context({ veilOpen: true })), { do: 'open-spotlight' }, 'over the veil')
  assert.equal(resolveKey({ key: 'k', meta: true }, context({ inOverlay: true })), null, 'a dialog, the spotlight among them, keeps the key')
  assert.equal(resolveKey({ key: 'k', meta: true, shift: true }, context()), null)
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
  assert.equal(resolveKey({ key: 'y', meta: true, shift: true }, context()), null)
  assert.equal(resolveKey({ key: 'y', meta: true, alt: true }, context()), null)
})

test('a dialog or menu that owns the keyboard keeps every key', () => {
  assert.equal(resolveKey({ key: '1', meta: true }, context({ inOverlay: true })), null)
  assert.equal(resolveEscape(context({ zone: 'other', inOverlay: true }), false), null)
})

test('with the veil open, up and down walk its list, enter chooses and escape closes, wherever the keyboard is', () => {
  for (const zone of ['input', 'agents', 'veil', 'canvas', 'other'] as const) {
    for (const messageEmpty of [true, false]) {
      const open = context({ zone, messageEmpty, veilOpen: true })
      assert.deepEqual(resolveKey({ key: 'ArrowDown' }, open), { do: 'veil-move', delta: 1 }, zone)
      assert.deepEqual(resolveKey({ key: 'ArrowUp' }, open), { do: 'veil-move', delta: -1 }, zone)
      assert.deepEqual(resolveKey({ key: 'Enter' }, open), { do: 'veil-choose' }, zone)
      assert.deepEqual(resolveKey({ key: 'Escape' }, open), { do: 'close-veil' }, zone)
    }
  }
})

test('with the veil open, other keys still type', () => {
  const open = context({ veilOpen: true })
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

test('command r reloads the window from anywhere, a panel of the screen too, but not from a dialog over the window', () => {
  assert.deepEqual(resolveKey({ key: 'r', meta: true }, context()), { do: 'reload' })
  assert.deepEqual(resolveKey({ key: 'r', meta: true }, context({ zone: 'canvas', inOverlay: true })), { do: 'reload' })
  assert.deepEqual(resolveKey({ key: 'R', meta: true, shift: true }, context()), { do: 'reload' }, 'with Shift too, as in a browser')
  assert.equal(resolveKey({ key: 'r', meta: true, alt: true }, context()), null, 'command option r belongs to something else')
  assert.equal(resolveKey({ key: 'r', meta: true }, context({ zone: 'other', inOverlay: true })), null, 'a modal dialog keeps it')
})

test('command left and right go back and forward, and stay text editing in any text field', () => {
  for (const zone of ['agents', 'veil', 'canvas', 'other'] as const) {
    assert.deepEqual(resolveKey({ key: 'ArrowLeft', meta: true }, context({ zone })), { do: 'go-back' }, zone)
    assert.deepEqual(resolveKey({ key: 'ArrowRight', meta: true }, context({ zone })), { do: 'go-forward' }, zone)
  }
  assert.deepEqual(resolveKey({ key: 'ArrowLeft', meta: true }, context({ zone: 'canvas', inOverlay: true })), { do: 'go-back' }, 'a panel of the screen')
  for (const key of ['ArrowLeft', 'ArrowRight']) {
    assert.equal(resolveKey({ key, meta: true }, context({ zone: 'input' })), null, `${key}: the message input`)
    assert.equal(resolveKey({ key, meta: true }, context({ zone: 'canvas', typing: true })), null, `${key}: a text field on a screen`)
    assert.equal(resolveKey({ key, meta: true }, context({ zone: 'other', inOverlay: true })), null, `${key}: a dialog over the window`)
    assert.equal(resolveKey({ key, meta: true, shift: true }, context({ zone: 'canvas' })), null, `Shift+Command+${key} selects`)
  }
})

test('escape that nothing used leaves a screen that is open only for now', () => {
  for (const screen of ['review', 'settings', 'integrations'] as const) {
    assert.deepEqual(resolveEscape(context({ zone: 'canvas', screen }), false), { do: 'leave-screen' }, screen)
    assert.deepEqual(resolveEscape(context({ zone: 'other', screen }), false), { do: 'leave-screen' }, `${screen}, with the keyboard nowhere`)
    assert.equal(resolveEscape(context({ zone: 'canvas', screen }), true), null, `${screen}, when the screen used the key`)
    assert.deepEqual(resolveEscape(context({ zone: 'input', screen }), false), { do: 'leave-screen' }, `${screen}, from the message input`)
    assert.equal(resolveEscape(context({ zone: 'input', screen, inOverlay: true }), false), null, `${screen}, while completions own the input`)
    assert.equal(resolveEscape(context({ zone: 'input', screen }), true), null, `${screen}, after the editor handled Escape`)
  }

  assert.deepEqual(resolveEscape(context({ zone: 'canvas', screen: 'work' }), false), { do: 'focus-input' }, 'a menu screen stays open')
  assert.deepEqual(resolveEscape(context({ zone: 'canvas', screen: 'github' }), false), { do: 'focus-input' }, 'github in the menu is a menu screen')
  assert.deepEqual(resolveEscape(context({ zone: 'canvas', screen: 'github', githubInMenu: false }), false), { do: 'leave-screen' }, 'github opened while the menu leaves it out')
})
