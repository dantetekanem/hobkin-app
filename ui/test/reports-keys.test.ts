import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reportsKey, type KeyContext } from '../src/features/reports/keys.ts'

const at = (where: KeyContext['where'], over: Partial<KeyContext> = {}): KeyContext => ({ where, titleEmpty: true, canUndo: false, ...over })

test('on a report, enter and left open it, toward the reader on the left, and the letters act on it', () => {
  assert.deepEqual(reportsKey({ key: 'Enter' }, at('row')), { do: 'open' })
  assert.deepEqual(reportsKey({ key: 'ArrowLeft' }, at('row')), { do: 'open' }, 'the list is on the right and the report opens on its left')
  assert.deepEqual(reportsKey({ key: 'r' }, at('row')), { do: 'reply' })
  assert.deepEqual(reportsKey({ key: 'm' }, at('row')), { do: 'reply' }, 'as in the terminal app')
  assert.deepEqual(reportsKey({ key: 'Backspace' }, at('row')), { do: 'delete' })
  assert.deepEqual(reportsKey({ key: 'Delete' }, at('row')), { do: 'delete' })
  assert.deepEqual(reportsKey({ key: '/' }, at('row')), { do: 'find' })

  assert.equal(reportsKey({ key: 'ArrowDown' }, at('row')), null, 'up and down are the walk between controls')
  assert.equal(reportsKey({ key: 'ArrowUp' }, at('row')), null)
  assert.equal(reportsKey({ key: 'ArrowRight' }, at('row')), null, 'nothing lies to the right of the list')
  assert.equal(reportsKey({ key: 'x' }, at('row')), null)
})

test('left and right change which kind of report is shown', () => {
  assert.deepEqual(reportsKey({ key: 'ArrowRight' }, at('kind')), { do: 'kind', delta: 1 })
  assert.deepEqual(reportsKey({ key: 'ArrowLeft' }, at('kind')), { do: 'kind', delta: -1 })
  assert.deepEqual(reportsKey({ key: '/' }, at('kind')), { do: 'find' })
  assert.equal(reportsKey({ key: 'Enter' }, at('kind')), null, 'enter presses the choice itself')
  assert.equal(reportsKey({ key: 'r' }, at('kind')), null, 'no report has the keyboard')
})

test('the title field keeps its letters, and enter reads the first match', () => {
  for (const key of ['r', 'm', 'u', '/', ' ', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) {
    assert.equal(reportsKey({ key }, at('title', { titleEmpty: false, canUndo: true })), null, `${key} belongs to the text`)
  }
  assert.deepEqual(reportsKey({ key: 'Enter' }, at('title', { titleEmpty: false })), { do: 'open-first' })
  assert.equal(reportsKey({ key: 'ArrowDown' }, at('title')), null, 'down walks on to the list')
})

test('in the reader, escape goes back, left and right or up and down step, and the page keys scroll', () => {
  assert.deepEqual(reportsKey({ key: 'Escape' }, at('reader')), { do: 'close' })
  assert.deepEqual(reportsKey({ key: 'ArrowRight' }, at('reader')), { do: 'step', delta: 1 })
  assert.deepEqual(reportsKey({ key: 'ArrowLeft' }, at('reader')), { do: 'step', delta: -1 })

  assert.deepEqual(reportsKey({ key: 'ArrowDown' }, at('reader')), { do: 'step', delta: 1 }, 'down is the next report, as in the list')
  assert.deepEqual(reportsKey({ key: 'ArrowUp' }, at('reader')), { do: 'step', delta: -1 })
  assert.deepEqual(reportsKey({ key: 'PageDown' }, at('reader')), { do: 'scroll', by: 'page', delta: 1 })
  assert.deepEqual(reportsKey({ key: 'PageUp' }, at('reader')), { do: 'scroll', by: 'page', delta: -1 })
  assert.deepEqual(reportsKey({ key: ' ' }, at('reader')), { do: 'scroll', by: 'page', delta: 1 })
  assert.deepEqual(reportsKey({ key: ' ', shift: true }, at('reader')), { do: 'scroll', by: 'page', delta: -1 })
  assert.deepEqual(reportsKey({ key: 'End' }, at('reader')), { do: 'scroll', by: 'all', delta: 1 })
  assert.deepEqual(reportsKey({ key: 'Home' }, at('reader')), { do: 'scroll', by: 'all', delta: -1 })

  assert.deepEqual(reportsKey({ key: 'r' }, at('reader')), { do: 'reply' })
  assert.deepEqual(reportsKey({ key: 'Backspace' }, at('reader')), { do: 'delete' })
  assert.equal(reportsKey({ key: 'Enter' }, at('reader')), null, 'enter is left for a button that has the keyboard')
  assert.equal(reportsKey({ key: '/' }, at('reader')), null, 'the list is behind the report')
})

test('escape steps back once: out of the reader, then out of the title filter, then on to the frame', () => {
  assert.deepEqual(reportsKey({ key: 'Escape' }, at('reader', { titleEmpty: false })), { do: 'close' }, 'the reader first, and the filter stays')

  for (const where of ['row', 'kind', 'title', 'other'] as const) {
    assert.deepEqual(reportsKey({ key: 'Escape' }, at(where, { titleEmpty: false })), { do: 'clear-title' }, where)
    assert.equal(reportsKey({ key: 'Escape' }, at(where)), null, `${where}: with nothing to step back from, the frame takes the keyboard home`)
  }
})

test('undo is there only while its line shows', () => {
  for (const where of ['row', 'kind', 'reader', 'other'] as const) {
    assert.deepEqual(reportsKey({ key: 'u' }, at(where, { canUndo: true })), { do: 'undo' }, where)
    assert.equal(reportsKey({ key: 'u' }, at(where)), null, where)
  }
})

test("a key held with command, control or option is not the screen's", () => {
  for (const where of ['row', 'kind', 'title', 'reader', 'other'] as const) {
    assert.equal(reportsKey({ key: 'r', meta: true }, at(where)), null, 'Command+R')
    assert.equal(reportsKey({ key: 'Backspace', meta: true }, at(where)), null)
    assert.equal(reportsKey({ key: 'ArrowRight', alt: true }, at(where)), null)
    assert.equal(reportsKey({ key: 'Enter', ctrl: true }, at(where)), null)
  }
  assert.equal(reportsKey({ key: 'Tab' }, at('row')), null, 'tab is always the frame')
  assert.equal(reportsKey({ key: 'R', shift: true }, at('row')), null, 'a capital is not the shortcut')
})
