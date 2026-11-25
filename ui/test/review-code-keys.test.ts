import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diffOf, startView, unifiedRows } from '../src/features/review/code/diff-rows.ts'
import type { KeyPress } from '../src/features/review/keys.ts'
import { codeKey, type CodeKeyState } from '../src/features/review/diff/code-keys.ts'
import type { Cursor } from '../src/features/review/diff/cursor.ts'

// Forty lines with three groups of changes far apart, as in review-code-cursor.test.ts.
const base = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`)
const head = [
  ...base.slice(0, 4),
  'changed 5',
  ...base.slice(7, 20),
  'new A',
  'new B',
  ...base.slice(20, 34),
  'changed 35',
  ...base.slice(35),
]
const diff = diffOf(`${base.join('\n')}\n`, `${head.join('\n')}\n`)
const view = startView(diff)

const single = (side: Cursor['side'], line: number, column: Cursor['column'] = side === 'deleted' ? 'old' : 'new'): Cursor => ({ side, line, anchor: line, column })
const files = [
  { id: 'a', seen: true },
  { id: 'b', seen: false },
  { id: 'c', seen: true },
  { id: 'd', seen: false },
]
/** File b shown in one column, the keyboard in its diff, the cursor on its first changed line. */
const state = (more: Partial<CodeKeyState> = {}): CodeKeyState => ({
  pane: 'diff',
  files,
  file: 'b',
  diff,
  view,
  cursor: single('deleted', 5),
  split: false,
  page: 4,
  filesPage: 2,
  ...more,
})
const press = (key: string, more: Partial<KeyPress> = {}): KeyPress => ({ key, shift: false, alt: false, ...more })

test('with the files focused, Up and Down change the file, and Enter or Right goes to its diff', () => {
  const inList = state({ pane: 'files' })
  assert.deepEqual(codeKey(press('ArrowDown'), inList), { file: 'c' })
  assert.deepEqual(codeKey(press('ArrowUp'), inList), { file: 'a' })
  assert.deepEqual(codeKey(press('ArrowUp'), state({ pane: 'files', file: 'a' })), {}, 'the first file is as far as it goes')
  assert.deepEqual(codeKey(press('End'), inList), { file: 'd' })
  assert.deepEqual(codeKey(press('PageDown'), inList), { file: 'd' })
  assert.deepEqual(codeKey(press('Enter'), inList), { pane: 'diff', scroll: 'keep' })
  assert.deepEqual(codeKey(press('ArrowRight'), inList), { pane: 'diff', scroll: 'keep' })
  // With the files focused, a note is about the file, so Escape has no selection to take back: it is the review's.
  assert.equal(codeKey(press('Escape'), inList), null)
})

test('] and [ go to the next and previous file, round the ends, and U and Shift+U to the next and previous not seen', () => {
  assert.deepEqual(codeKey(press(']'), state({ file: 'd' })), { file: 'a' })
  assert.deepEqual(codeKey(press('['), state({ file: 'a' })), { file: 'd' })
  assert.deepEqual(codeKey(press('u'), state()), { file: 'd' })
  assert.deepEqual(codeKey(press('U', { shift: true }), state({ file: 'd' })), { file: 'b' })
  assert.deepEqual(codeKey(press('u'), state({ files: files.map((file) => ({ ...file, seen: file.id !== 'b' })) })), { say: 'This is the last file not seen yet.' })
  assert.deepEqual(codeKey(press('u'), state({ files: files.map((file) => ({ ...file, seen: true })) })), { say: 'Every file is seen.' })
  // The keys of the files work with the diff focused too, and leave it focused.
  assert.deepEqual(codeKey(press(']'), state({ pane: 'diff' })), { file: 'c' })
})

test('Z and R mark the file seen, V gives two columns, E shows more and F the whole file', () => {
  assert.deepEqual(codeKey(press('z'), state()), { seen: 'b' })
  assert.deepEqual(codeKey(press('R'), state({ pane: 'files' })), { seen: 'b' })
  assert.deepEqual(codeKey(press('v'), state()), { split: true })
  const more = codeKey(press('e'), state())?.view
  assert.ok(more)
  const gaps = unifiedRows(diff, more).filter((item) => item.type === 'gap')
  assert.equal(gaps.length, 0, 'twenty more lines close every gap of this file')
  assert.equal(codeKey(press('f'), state())?.view?.whole, true)
  assert.deepEqual(codeKey(press('e'), state({ diff: null, view: null, cursor: null })), {}, 'nothing to show more of while the file is read')
})

test('in the diff Up and Down move through changes, Option through every line, Shift selects, and the view follows', () => {
  assert.deepEqual(codeKey(press('ArrowDown'), state()), { cursor: single('deleted', 6), view, scroll: 'keep' })
  const option = codeKey(press('ArrowDown', { alt: true }), state({ cursor: single('added', 8) }))!
  assert.deepEqual(option.cursor, single('added', 9))
  assert.notEqual(option.view, view, 'the unchanged line it came to is opened')
  assert.deepEqual(codeKey(press('ArrowDown', { shift: true }), state())?.cursor, { side: 'deleted', line: 6, anchor: 5, column: 'old' })
  assert.deepEqual(codeKey(press('ArrowUp'), state()), {}, 'above the first change, nothing')
  assert.deepEqual(codeKey(press('End'), state())?.cursor, single('added', 35))
  assert.deepEqual(codeKey(press('Home'), state({ cursor: single('added', 35) }))?.cursor, single('deleted', 5))
  // Page Down moves the cursor a page of lines and scrolls the view by as many.
  assert.deepEqual(codeKey(press('PageDown'), state()), { cursor: single('added', 6), scroll: 4 })
})

test('Left goes back to the files, and in two columns first from the new side to the old', () => {
  assert.deepEqual(codeKey(press('ArrowLeft'), state()), { pane: 'files' })
  assert.deepEqual(codeKey(press('ArrowLeft'), state({ split: true, cursor: single('added', 5) })), { cursor: single('deleted', 5), scroll: 'keep' })
  assert.deepEqual(codeKey(press('ArrowLeft'), state({ split: true, cursor: single('deleted', 5) })), { pane: 'files' })
  assert.deepEqual(codeKey(press('ArrowRight'), state({ split: true, cursor: single('deleted', 5) })), { cursor: single('added', 5), scroll: 'keep' })
  assert.deepEqual(codeKey(press('ArrowRight'), state()), {}, 'in one column Right has nowhere to go')
})

test('J and K go to the next and previous group of changes, from the files too, and say when there is none', () => {
  assert.deepEqual(codeKey(press('j'), state()), { pane: 'diff', cursor: single('added', 19), scroll: 'keep' })
  assert.deepEqual(codeKey(press('J'), state({ pane: 'files' })), { pane: 'diff', cursor: single('added', 19), scroll: 'keep' })
  assert.deepEqual(codeKey(press('k'), state()), { say: 'No change above this one in the file.' })
  assert.deepEqual(codeKey(press('j'), state({ cursor: single('added', 35) })), { say: 'No change below this one in the file.' })
})

test('Escape takes a selection of several lines back to the cursor line, and every key the code view does not own is the review own', () => {
  assert.deepEqual(codeKey(press('Escape'), state({ cursor: { side: 'deleted', line: 7, anchor: 5, column: 'old' } })), { cursor: single('deleted', 7) })
  assert.equal(codeKey(press('Escape'), state()), null)
  for (const key of ['c', 'n', 'd', 'h', 'a', 'm', 'x', 's', 't', 'i', 'o', 'p', '/', 'Enter', 'l']) assert.equal(codeKey(press(key), state()), null, key)
  assert.equal(codeKey(press('S', { shift: true }), state()), null)
  // A cursor kept on a line no longer drawn moves from the nearest one.
  assert.deepEqual(codeKey(press('ArrowDown'), state({ cursor: single('added', 12) }))?.cursor, single('added', 19))
})
