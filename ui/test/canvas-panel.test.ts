import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CanvasState } from '#shared/protocol/canvas.ts'
import { frameOf, loadFresh, markLoaded, markReady, onScreen, readFrameMessage, revise, settle, startFrames } from '../src/features/canvas-panel/live-frame.ts'
import { canSave, canvasKey, drawingOf, frameSrc, labelFor, passedKey, sandboxFor, windowCanvas, type FrameKey } from '../src/features/canvas-panel/rules.ts'
import { hereOf, savedNote, useCanvasBoards } from '../src/features/canvas-panel/store.ts'

const boards = () => useCanvasBoards.getState()
const DRAWING: CanvasState = { open: true, url: 'http://127.0.0.1:9/canvas/k?r=1', title: 'Plan', kind: 'drawing', revision: 1 }

test('a page on this Mac runs with its own origin, any other page without it', () => {
  assert.match(sandboxFor('http://localhost:3000/'), /allow-scripts allow-same-origin/)
  assert.match(sandboxFor('http://127.0.0.1:3000/'), /allow-same-origin/)
  for (const other of ['https://example.com', 'http://example.com', 'https://localhost:3000', 'http://localhost.evil.com']) {
    assert.doesNotMatch(sandboxFor(other), /allow-same-origin/, other)
  }
  assert.doesNotMatch(sandboxFor('https://example.com'), /top-navigation/)
})

test('the canvas is named by its title, or by its host', () => {
  assert.equal(labelFor('http://localhost:3000/x', ' My app '), 'My app')
  assert.equal(labelFor('http://localhost:3000/x', null), 'localhost:3000')
})

test('a drawing runs scripts without an origin, and its frame opens on the theme and Still showing now', () => {
  const sandbox = sandboxFor('http://127.0.0.1:5000/drawing', 'drawing')
  assert.match(sandbox, /allow-scripts/)
  assert.doesNotMatch(sandbox, /allow-same-origin/)
  assert.match(sandboxFor('http://127.0.0.1:5000/', 'page'), /allow-same-origin/)
  assert.equal(labelFor('http://127.0.0.1:5000/d', null, 'drawing'), 'Drawing')
  assert.equal(labelFor('http://127.0.0.1:5000/d', 'Plan', 'drawing'), 'Plan')
  assert.equal(frameSrc('http://127.0.0.1:9/canvas/k?r=3', 'dark', true), 'http://127.0.0.1:9/canvas/k?r=3&theme=dark&still=1')
  assert.equal(frameSrc('http://127.0.0.1:9/canvas/k?r=3', 'light', false), 'http://127.0.0.1:9/canvas/k?r=3&theme=light&still=0')
  assert.equal(drawingOf('http://127.0.0.1:9/canvas/k?r=3'), drawingOf('http://127.0.0.1:9/canvas/k?r=4'), 'a new revision is the same drawing')
  assert.notEqual(drawingOf('http://127.0.0.1:9/canvas/k?r=3'), drawingOf('http://127.0.0.1:9/canvas/other?r=3'))
})

test("the window takes a drawing's messages only from that frame's own window, and only the contract's", () => {
  const own = {}
  const behind = {}
  const windows = [[4, own], [5, behind]] as const
  assert.equal(frameOf(own, windows), 4)
  assert.equal(frameOf(behind, windows), 5, 'a frame loading behind is one of its own too')
  assert.equal(frameOf({}, windows), null, 'another window')
  assert.equal(frameOf(null, windows), null)

  assert.deepEqual(readFrameMessage({ hobkin: 'canvas', type: 'ready', version: 1 }), { type: 'ready', version: 1 })
  assert.deepEqual(readFrameMessage({ hobkin: 'canvas', type: 'load', url: 'http://127.0.0.1:9/canvas/k?r=2' }), { type: 'load', url: 'http://127.0.0.1:9/canvas/k?r=2' })
  const key = { key: 'Escape', code: 'Escape', meta: false, ctrl: false, alt: false, shift: false }
  assert.deepEqual(readFrameMessage({ hobkin: 'canvas', type: 'key', ...key }), { type: 'key', ...key })
  const wrong = [
    null,
    'ready',
    { type: 'ready', version: 1 },
    { hobkin: 'other', type: 'ready', version: 1 },
    { hobkin: 'canvas', type: 'ready', version: 2 },
    { hobkin: 'canvas', type: 'load' },
    { hobkin: 'canvas', type: 'key', key: 'Escape' },
    { hobkin: 'canvas', type: 'revision', url: 'http://127.0.0.1:9/canvas/k?r=2' },
  ]
  for (const data of wrong) assert.equal(readFrameMessage(data), null, JSON.stringify(data))
})

test('a revision becomes a message once the drawing is ready, and a fresh load behind the one on screen before it', () => {
  const at = (revision: number) => `http://127.0.0.1:9/canvas/k?r=${revision}`
  // Nothing on screen yet: a revision takes the first frame's place.
  let step = revise(startFrames(at(1), 'src-1'), at(2), 'src-2')
  assert.equal(step.post, null)
  assert.deepEqual(step.frames.list.map((frame) => frame.url), [at(2)])
  let frames = markLoaded(step.frames, step.frames.list[0]!.id)

  // Loaded but never ready, as from a host older than the runtime: the next revision loads behind.
  step = revise(frames, at(3), 'src-3')
  assert.equal(step.post, null)
  assert.deepEqual(step.frames.list.map((frame) => [frame.url, frame.loaded]), [[at(2), true], [at(3), false]])
  assert.equal(onScreen(step.frames).url, at(2), 'the one on screen stays while the new one loads')
  const fresh = step.frames.list[1]!.id
  frames = markLoaded(step.frames, fresh)
  assert.equal(onScreen(frames).id, fresh, 'loaded, it shows over the old one')
  frames = settle(frames, fresh)
  assert.deepEqual(frames.list.map((frame) => frame.id), [fresh], 'and the old one goes')

  // Ready: the revision is told to the frame on screen, which changes the drawing in place.
  frames = markReady(frames, fresh)
  step = revise(frames, at(4), 'src-4')
  assert.deepEqual(step.post, { to: fresh, url: at(4) })
  assert.deepEqual(step.frames.list.map((frame) => [frame.id, frame.url]), [[fresh, at(4)]])

  // The drawing asks for a fresh load, as Reload does, and a revision meanwhile replaces that load: the newest loads.
  frames = loadFresh(step.frames, at(4), 'src-4b')
  assert.equal(frames.list.length, 2)
  step = revise(frames, at(5), 'src-5')
  assert.equal(step.post, null)
  assert.deepEqual(step.frames.list.map((frame) => frame.url), [at(4), at(5)])
  assert.equal(onScreen(step.frames).id, fresh)
})

test('a key from a drawing reaches the app only from the set it passes on, and only while its frame has the keyboard', () => {
  // A key message with nothing pressed, then the press.
  const message = (press: Partial<FrameKey>) => ({
    type: 'key' as const, key: '', code: '', meta: false, ctrl: false, alt: false, shift: false, ...press,
  })
  const passes = [
    { key: 'Escape', code: 'Escape' },
    { key: 's', code: 'KeyS', meta: true },
    ...'123456789'.split('').map((digit) => ({ key: digit, code: `Digit${digit}`, meta: true })),
    { key: 'k', code: 'KeyK', meta: true },
    { key: 'l', code: 'KeyL', meta: true },
    { key: 'Enter', code: 'Enter', meta: true },
    { key: ',', code: 'Comma', meta: true },
    { key: 'j', code: 'KeyJ', meta: true },
    { key: 'y', code: 'KeyY', meta: true },
    { key: 'Tab', code: 'Tab', ctrl: true },
  ]
  for (const press of passes) assert.ok(passedKey(message(press), true), JSON.stringify(press))

  // Nothing that ends, stops, sends or reloads, and nothing with a modifier the set does not have.
  const refused = [
    { key: 'x', code: 'KeyX', ctrl: true },
    { key: 'r', code: 'KeyR', meta: true },
    { key: 'n', code: 'KeyN', meta: true },
    { key: 'c', code: 'KeyC', ctrl: true },
    { key: 'Enter', code: 'Enter' },
    { key: 'Tab', code: 'Tab' },
    { key: 'Escape', code: 'Escape', shift: true },
    { key: 's', code: 'KeyS', meta: true, shift: true },
    { key: 'k', code: 'KeyK', meta: true, alt: true },
    { key: '0', code: 'Digit0', meta: true },
  ]
  for (const press of refused) assert.equal(passedKey(message(press), true), null, JSON.stringify(press))

  assert.equal(passedKey(message({ key: 'Escape', code: 'Escape' }), false), null, 'the frame does not have the keyboard')
  // What reaches the app is the key itself, never a code the drawing made up: a Tab cannot pass for Control+X.
  assert.deepEqual(passedKey(message({ key: 'Tab', code: 'KeyX', ctrl: true }), true), {
    key: 'Tab',
    code: 'Tab',
    metaKey: false,
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    bubbles: true,
    cancelable: true,
  })
})

test('a canvas closed here is gone at once, until the host says something new, and each canvas reloads on its own', () => {
  boards().closeHere('0123abcd', DRAWING)
  assert.equal(windowCanvas(DRAWING, hereOf(boards(), '0123abcd'))?.open, false)
  assert.equal(windowCanvas(DRAWING, hereOf(boards(), 'main')), DRAWING, "another hobkin's canvas stays")
  assert.equal(windowCanvas({ ...DRAWING, revision: 2 }, hereOf(boards(), '0123abcd'))?.open, true)

  boards().reload('main')
  assert.equal(boards().boards.main?.reloads, 1)
  assert.equal(boards().boards['0123abcd']?.reloads ?? 0, 0)
})

test('Save shows for a drawing only and says where the file went, until the canvas changes', async () => {
  assert.equal(canSave('drawing'), true)
  assert.equal(canSave('page'), false)
  assert.equal(canSave(undefined), false)

  const owners: string[] = []
  await boards().save('main', DRAWING, async () => {
    owners.push('main')
    return { path: '/Users/me/Downloads/plan.html' }
  })
  assert.deepEqual(owners, ['main'])
  assert.deepEqual(savedNote(boards().boards.main, DRAWING), { path: '/Users/me/Downloads/plan.html' })

  // The same canvas said again keeps the note; a new revision has none. Another hobkin's canvas never had it.
  assert.ok(savedNote(boards().boards.main, { ...DRAWING }))
  assert.equal(savedNote(boards().boards.main, { ...DRAWING, revision: 2 }), null)
  assert.equal(savedNote(boards().boards['0123abcd'], DRAWING), null)
  assert.equal(canvasKey(DRAWING), canvasKey({ ...DRAWING }))

  await boards().save('main', DRAWING, async () => Promise.reject(Error('A file is already there.')))
  assert.deepEqual(savedNote(boards().boards.main, DRAWING), { error: 'A file is already there.' })
})
