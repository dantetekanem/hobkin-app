import assert from 'node:assert/strict'
import { test } from 'node:test'
import { composerKey, type ComposerKeyContext } from '../src/features/chat/composer-keys.ts'

const idle: ComposerKeyContext = { turnRunning: false, canSend: true, empty: false, stopped: false, queued: false }
const working: ComposerKeyContext = { ...idle, turnRunning: true }
const enter = { key: 'Enter' }

test('Enter sends, and during a turn steers it, as Pi does', () => {
  assert.deepEqual(composerKey(enter, idle), { do: 'send' })
  assert.deepEqual(composerKey(enter, working), { do: 'send' })
  assert.equal(composerKey({ key: 'Enter', shift: true }, idle), null, 'Shift+Enter adds a line')
})

test('Alt+Enter queues a follow-up during a turn, and with no turn sends as Enter does', () => {
  assert.deepEqual(composerKey({ key: 'Enter', alt: true }, working), { do: 'follow-up' })
  assert.deepEqual(composerKey({ key: 'Enter', alt: true }, idle), { do: 'send' })
})

test('Control+Enter stops the turn and sends at once, and with no turn sends as Enter does', () => {
  assert.deepEqual(composerKey({ key: 'Enter', ctrl: true }, working), { do: 'interrupt' })
  assert.deepEqual(composerKey({ key: 'Enter', ctrl: true }, idle), { do: 'send' })
})

test('Enter in an empty input continues a turn the user stopped, and only then', () => {
  const empty = { ...idle, canSend: false, empty: true }
  assert.deepEqual(composerKey(enter, { ...empty, stopped: true }), { do: 'continue' })
  assert.deepEqual(composerKey(enter, empty), { do: 'nothing' }, 'with nothing to send or continue Enter does nothing, and adds no line')
  assert.deepEqual(composerKey(enter, { ...empty, stopped: true, turnRunning: true }), { do: 'nothing' }, 'a turn is running again')
  assert.deepEqual(composerKey({ key: 'Enter', alt: true }, { ...empty, stopped: true }), { do: 'nothing' }, 'only Enter continues')
  assert.deepEqual(composerKey(enter, { ...idle, canSend: false, stopped: true }), { do: 'nothing' }, 'words still uploading are not an empty input')
})

test('Alt+Up brings back what waits for the turn; with nothing waiting it keeps its Mac meaning', () => {
  assert.deepEqual(composerKey({ key: 'ArrowUp', alt: true }, { ...working, queued: true }), { do: 'dequeue' })
  assert.equal(composerKey({ key: 'ArrowUp', alt: true }, working), null)
})

test('the keys the frame and the editor own stay theirs', () => {
  assert.equal(composerKey({ key: 'Enter', meta: true }, working), null, 'Command+Enter goes to the input from anywhere')
  assert.equal(composerKey({ key: 'Enter', ctrl: true, shift: true }, working), null, "Shift+Control+Enter is the prompt editor's")
  assert.equal(composerKey({ key: 'Enter', ctrl: true, alt: true }, working), null)
  assert.equal(composerKey({ key: 'ArrowUp' }, { ...working, queued: true }), null, 'Up brings back what was sent before')
})

test('each key the input lists for a turn is listed, and does what the list says', async () => {
  const { KEY_LIST } = await import('../src/app/key-list.ts')
  const listed: [string, Parameters<typeof composerKey>[0], ComposerKeyContext, string][] = [
    ['↵', enter, working, 'send'],
    ['⌥↵', { key: 'Enter', alt: true }, working, 'follow-up'],
    ['⌃↵', { key: 'Enter', ctrl: true }, working, 'interrupt'],
    ['⌥↑', { key: 'ArrowUp', alt: true }, { ...working, queued: true }, 'dequeue'],
    ['↵', enter, { ...idle, canSend: false, empty: true, stopped: true }, 'continue'],
  ]
  for (const [keys, press, context, does] of listed) {
    assert.ok(KEY_LIST.some((entry) => entry.keys === keys && entry.where.includes('message input')), `${keys} is listed for the message input`)
    assert.equal(composerKey(press, context)?.do, does)
  }
})
