import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveEscape, resolveKey, type KeyContext } from '../src/app/key-map.ts'
import { walkScreens } from '../src/app/screens.ts'
import { pressEnd } from '../src/features/hobkins/conversation.ts'
import { forceStopStep } from '../src/features/work/actions.ts'

const MENU = ['home', 'reports', 'routines', 'actions', 'work', 'github'] as const

function context(overrides: Partial<KeyContext> = {}): KeyContext {
  return { zone: 'input', messageEmpty: true, screens: MENU, screen: 'work', inOverlay: false, veilOpen: false, asking: false, githubInMenu: true, ...overrides }
}

test('numbered screens follow the menu rows currently visible', () => {
  const MAIN = ['home', 'reports', 'routines', 'actions', 'work'] as const
  assert.deepEqual(walkScreens({ screen: 'work', reviewOpen: false, githubInMenu: true }), [...MAIN, 'github'])
  assert.deepEqual(walkScreens({ screen: 'work', reviewOpen: false, githubInMenu: false }), MAIN, 'GitHub is hidden')
  assert.deepEqual(walkScreens({ screen: 'github', reviewOpen: false, githubInMenu: false }), [...MAIN, 'github'], 'opened anyway')
  assert.deepEqual(walkScreens({ screen: 'work', reviewOpen: true, githubInMenu: true }), [...MAIN, 'github'], 'a retained review is not visible')
  assert.deepEqual(walkScreens({ screen: 'settings', reviewOpen: true, githubInMenu: true }), [...MAIN, 'github', 'settings'], 'Settings is the only visible contextual row')
  assert.deepEqual(walkScreens({ screen: 'review', reviewOpen: true, githubInMenu: true }), [...MAIN, 'github', 'review'], 'the active review is visible')
  assert.deepEqual(walkScreens({ screen: 'integrations', reviewOpen: true, githubInMenu: true }), [...MAIN, 'github', 'settings', 'integrations'], 'Integrations shows the Settings breadcrumb first')
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

test('Control+Option+S opens Nerd stats from anywhere', () => {
  const press = { key: 'ß', code: 'KeyS', ctrl: true, alt: true }
  for (const screen of ['reports', 'work', 'review', 'agent', 'settings'] as const) {
    for (const zone of ['input', 'agents', 'veil', 'canvas', 'other'] as const) {
      assert.deepEqual(resolveKey(press, context({ screen, zone, messageEmpty: false })), { do: 'toggle-nerd-stats' }, `${zone} on ${screen}`)
    }
  }
  assert.deepEqual(resolveKey({ ...press, key: 's' }, context()), { do: 'toggle-nerd-stats' }, 'whatever character it types')
  assert.deepEqual(resolveKey(press, context({ zone: 'canvas', inOverlay: true })), { do: 'toggle-nerd-stats' }, 'a panel of the screen')

  assert.equal(resolveKey(press, context({ zone: 'other', inOverlay: true })), null, 'a dialog over the window keeps it')
  for (const other of [{ ctrl: false }, { alt: false }, { meta: true }, { shift: true }, { code: 'KeyO' }]) {
    assert.equal(resolveKey({ ...press, ...other }, context()), null, JSON.stringify(other))
  }
})

test('a key that opens something closes it again', () => {
  const history = { key: 'y', code: 'KeyY', meta: true }
  assert.deepEqual(resolveKey(history, context()), { do: 'open-veil', section: 'history' })
  assert.deepEqual(resolveKey(history, context({ veilOpen: true, veilSection: 'history' })), { do: 'close-veil' }, 'History closes')

  const sheet = { key: 'n', code: 'KeyN', meta: true }
  assert.deepEqual(resolveKey(sheet, context({ zone: 'other', inOverlay: true, dialog: 'new-hobkin' })), { do: 'close-new-hobkin' }, 'the sheet closes, though it is a dialog')
  assert.equal(resolveKey(sheet, context({ zone: 'other', inOverlay: true })), null, 'another dialog keeps the key')

  const stats = { key: 'ß', code: 'KeyS', ctrl: true, alt: true }
  assert.deepEqual(resolveKey(stats, context({ zone: 'other', inOverlay: true, dialog: 'nerd-stats' })), { do: 'toggle-nerd-stats' }, 'Nerd stats closes')

  const prompt = { key: 'π', code: 'KeyP', ctrl: true, alt: true }
  assert.deepEqual(resolveKey(prompt, context({ zone: 'other', inOverlay: true, dialog: 'prompt' })), { do: 'open-prompt' }, 'the editor closes, its draft kept')
  assert.equal(resolveKey(stats, context({ zone: 'other', inOverlay: true, dialog: 'prompt' })), null, "another dialog's key is still the dialog's own")
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

test("control o opens or closes every block of the steps on an agent's screen and in hobkin's mind, typing included", () => {
  const press = { key: 'o', code: 'KeyO', ctrl: true }
  for (const screen of ['agent', 'mind'] as const) {
    for (const zone of ['input', 'agents', 'veil', 'canvas', 'other'] as const) {
      assert.deepEqual(resolveKey(press, context({ screen, zone, messageEmpty: false, typing: true })), { do: 'toggle-blocks' }, `${zone} on ${screen}`)
    }
  }
  assert.deepEqual(resolveKey(press, context({ screen: 'agent', zone: 'canvas', inOverlay: true })), { do: 'toggle-blocks' }, 'a panel of the screen')
  assert.equal(resolveKey(press, context({ screen: 'agent', zone: 'other', inOverlay: true })), null, 'a dialog over the window keeps it')
  for (const screen of ['reports', 'work', 'review', 'settings'] as const) {
    assert.equal(resolveKey(press, context({ screen })), null, `no steps to open on ${screen}`)
  }
  for (const other of [{ ctrl: false }, { meta: true }, { alt: true }, { shift: true }, { code: 'KeyP' }]) {
    assert.equal(resolveKey({ ...press, ...other }, context({ screen: 'agent' })), null, JSON.stringify(other))
  }
})

test('Control+X asks to end a durable hobkin, and again ends it', () => {
  const press = { key: 'x', code: 'KeyX', ctrl: true }
  const page = { screen: 'agent', hobkinPage: true } as const
  // From its page, its talk box or the agents list.
  for (const zone of ['canvas', 'agents', 'other'] as const) {
    assert.deepEqual(resolveKey(press, context({ ...page, zone, typing: zone === 'canvas' })), { do: 'end-hobkin' }, zone)
  }
  // One press and the same state as a click on End: the first asks, a second while it asks ends it, and none while it ends.
  assert.equal(pressEnd('no'), 'ask')
  assert.equal(pressEnd('asking'), 'end')
  assert.equal(pressEnd('busy'), null)

  // Never while a dialog is open, from the message input, or on another screen.
  assert.equal(resolveKey(press, context({ ...page, zone: 'other', inOverlay: true })), null, 'a dialog over the window')
  assert.equal(resolveKey(press, context({ ...page, zone: 'canvas', inOverlay: true })), null, 'a dialog or list in the page')
  assert.equal(resolveKey(press, context({ ...page, zone: 'input' })), null, 'the main message input')
  for (const screen of ['home', 'work', 'mind', 'settings'] as const) {
    assert.equal(resolveKey(press, context({ screen, zone: 'canvas' })), null, screen)
  }
  for (const other of [{ ctrl: false }, { meta: true }, { alt: true }, { shift: true }, { code: 'KeyC' }]) {
    assert.equal(resolveKey({ ...press, ...other }, context({ ...page, zone: 'canvas' })), null, JSON.stringify(other))
  }
})

test("Control+X force stops any other agent's run, asking first", () => {
  const press = { key: 'x', code: 'KeyX', ctrl: true }
  const page = { screen: 'agent' } as const
  // From its page, its talk box or the agents list, as End on a durable hobkin's page.
  for (const zone of ['canvas', 'agents', 'other'] as const) {
    assert.deepEqual(resolveKey(press, context({ ...page, zone, typing: zone === 'canvas' })), { do: 'force-stop' }, zone)
  }
  assert.deepEqual(resolveKey(press, context({ ...page, hobkinPage: true, zone: 'canvas' })), { do: 'end-hobkin' }, "a durable hobkin's page keeps End")
  assert.equal(resolveKey(press, context({ ...page, zone: 'canvas', inOverlay: true })), null, 'a dialog or list in the page')
  assert.equal(resolveKey(press, context({ ...page, zone: 'input' })), null, 'the main message input')

  // The same press as Force Stop: the first asks, and a second while the page asks about this run forces it.
  const run = 'session:review'
  const live = { runId: run, canForce: true, pending: false }
  const question = (id: string, mode?: 'stop' | 'force') => ({ id, title: 'Review', project: 'storefront', kind: 'run', ...(mode ? { mode } : {}) })
  assert.equal(forceStopStep({ ...live, asking: null }), 'ask')
  assert.equal(forceStopStep({ ...live, asking: question(run, 'force') }), 'force')
  assert.equal(forceStopStep({ ...live, asking: question(run) }), 'ask', 'a Stop question becomes the Force Stop one')
  assert.notEqual(forceStopStep({ ...live, asking: question('work:other:1', 'force') }), 'force', "another run's question is not confirmed")
  // Nothing while it is being forced, or once it cannot be forced, as a finished run cannot.
  assert.equal(forceStopStep({ ...live, pending: true, asking: question(run, 'force') }), null)
  assert.equal(forceStopStep({ ...live, canForce: false, asking: null }), null)
  assert.equal(forceStopStep({ ...live, canForce: false, asking: question(run, 'force') }), null)
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

test('command-number opens the screen at its visible menu position', () => {
  assert.deepEqual(resolveKey({ key: '1', meta: true }, context()), { do: 'open-screen', screen: 'home', focusCanvas: true })
  assert.deepEqual(resolveKey({ key: '2', meta: true }, context()), { do: 'open-screen', screen: 'reports', focusCanvas: true })
  assert.deepEqual(resolveKey({ key: '5', meta: true }, context({ zone: 'canvas' })), { do: 'open-screen', screen: 'work', focusCanvas: true })
  assert.deepEqual(resolveKey({ key: '6', meta: true }, context()), { do: 'open-screen', screen: 'github', focusCanvas: true })
  assert.equal(resolveKey({ key: '7', meta: true }, context()), null, 'there is no seventh visible item')

  const settings = walkScreens({ screen: 'settings', reviewOpen: true, githubInMenu: true })
  assert.deepEqual(resolveKey({ key: '7', meta: true }, context({ screens: settings })), { do: 'open-screen', screen: 'settings', focusCanvas: true })
  const integrations = walkScreens({ screen: 'integrations', reviewOpen: true, githubInMenu: true })
  assert.deepEqual(resolveKey({ key: '7', meta: true }, context({ screens: integrations })), { do: 'open-screen', screen: 'settings', focusCanvas: true })
  assert.deepEqual(resolveKey({ key: '8', meta: true }, context({ screens: integrations })), { do: 'open-screen', screen: 'integrations', focusCanvas: true })

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

test('Command+N opens the New hobkin sheet', () => {
  for (const screen of ['home', 'work', 'agent', 'review', 'settings', 'mind'] as const) {
    for (const zone of ['input', 'agents', 'veil', 'canvas', 'other'] as const) {
      assert.deepEqual(resolveKey({ key: 'n', code: 'KeyN', meta: true }, context({ screen, zone, messageEmpty: false, typing: zone === 'input' })), { do: 'new-hobkin' }, `${zone} on ${screen}`)
    }
  }
  assert.deepEqual(resolveKey({ key: 'n', meta: true }, context({ veilOpen: true })), { do: 'new-hobkin' }, 'over the veil')
  assert.equal(resolveKey({ key: 'n', meta: true }, context({ inOverlay: true })), null, 'a dialog open, the sheet itself among them, keeps it')
  assert.equal(resolveKey({ key: 'n', meta: true }, context({ zone: 'canvas', inOverlay: true })), null, 'a panel of the screen keeps it too')
  for (const other of [{ shift: true }, { alt: true }, { ctrl: true }, { meta: false }]) {
    assert.equal(resolveKey({ key: 'n', meta: true, ...other }, context()), null, JSON.stringify(other))
  }
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
  for (const screen of ['review', 'settings', 'integrations', 'world'] as const) {
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

const MAIN_BOARD = { owner: 'main', kind: 'drawing' } as const
const SPLIT = { screen: 'agent', hobkinPage: true, canvasShowing: { owner: '0123abcd', agent: 'talk' } } as const

test('escape closes the canvas that has the keyboard: its area, its drawing or its controls in the menu', () => {
  assert.deepEqual(resolveEscape(context({ zone: 'canvas', screen: 'canvas', board: MAIN_BOARD }), false), { do: 'close-canvas', owner: 'main' })
  assert.deepEqual(resolveEscape(context({ ...SPLIT, zone: 'canvas', board: { owner: '0123abcd', kind: 'page' } }), false), { do: 'close-canvas', owner: '0123abcd' }, "a durable hobkin's split, though its page is open only for now")
  assert.equal(resolveEscape(context({ zone: 'canvas', screen: 'canvas', board: MAIN_BOARD }), true), null, 'what has the keyboard used it')
  assert.equal(resolveEscape(context({ zone: 'canvas', screen: 'canvas', board: MAIN_BOARD, inOverlay: true }), false), null, 'a dialog keeps it')
})

test('escape anywhere else leaves the canvas open', () => {
  assert.equal(resolveEscape(context({ zone: 'input', screen: 'canvas' }), false), null, 'the canvas is not a place open only for now')
  for (const zone of ['agents', 'veil', 'canvas', 'other'] as const) {
    assert.deepEqual(resolveEscape(context({ zone, screen: 'canvas' }), false), { do: 'focus-input' }, zone)
  }
  // In the split the agents list is covered, so Escape in the talk box leaves the page, as it does with no list.
  assert.deepEqual(resolveEscape(context({ ...SPLIT, zone: 'canvas', typing: true }), false), { do: 'leave-screen' })
})

test('command s saves the drawing that has the keyboard, and nothing else', () => {
  const press = { key: 's', code: 'KeyS', meta: true }
  assert.deepEqual(resolveKey(press, context({ zone: 'canvas', screen: 'canvas', board: MAIN_BOARD })), { do: 'save-canvas', owner: 'main' })
  assert.deepEqual(resolveKey(press, context({ ...SPLIT, zone: 'canvas', board: { owner: '0123abcd', kind: 'drawing' } })), { do: 'save-canvas', owner: '0123abcd' })
  assert.equal(resolveKey(press, context({ zone: 'canvas', screen: 'canvas', board: { owner: 'main', kind: 'page' } })), null, 'a page is not saved')
  assert.equal(resolveKey(press, context({ zone: 'canvas', screen: 'canvas' })), null, 'the keyboard on the screen, not in the canvas')
  assert.equal(resolveKey(press, context({ zone: 'input', screen: 'canvas' })), null, 'the message input')
  for (const other of [{ shift: true }, { alt: true }, { ctrl: true }]) {
    assert.equal(resolveKey({ ...press, ...other }, context({ zone: 'canvas', screen: 'canvas', board: MAIN_BOARD })), null, JSON.stringify(other))
  }
})

test('control tab moves the keyboard between a canvas on screen and its agent, and keeps its meaning without one', () => {
  const press = { key: 'Tab', code: 'Tab', ctrl: true }
  const place = { screen: 'canvas', canvasShowing: { owner: 'main', agent: 'input' } } as const
  for (const zone of ['input', 'agents', 'other', 'canvas'] as const) {
    assert.deepEqual(resolveKey(press, context({ ...place, zone })), { do: 'focus-board', owner: 'main' }, `into the canvas from ${zone}`)
  }
  assert.deepEqual(resolveKey(press, context({ ...place, zone: 'canvas', board: MAIN_BOARD })), { do: 'focus-canvas-agent', agent: 'input' }, 'back to the message input')
  assert.deepEqual(resolveKey(press, context({ ...SPLIT, zone: 'canvas', typing: true })), { do: 'focus-board', owner: '0123abcd' }, 'from the talk box')
  assert.deepEqual(resolveKey(press, context({ ...SPLIT, zone: 'canvas', board: { owner: '0123abcd', kind: 'page' } })), { do: 'focus-canvas-agent', agent: 'talk' })

  assert.equal(resolveKey(press, context({ zone: 'canvas', screen: 'work' })), null, 'no canvas on screen')
  assert.equal(resolveKey(press, context({ ...place, zone: 'other', inOverlay: true })), null, 'a dialog keeps it')
  for (const other of [{ shift: true }, { alt: true }, { meta: true }, { ctrl: false }]) {
    assert.equal(resolveKey({ ...press, ...other }, context({ ...place, zone: 'input' })), null, JSON.stringify(other))
  }
})
