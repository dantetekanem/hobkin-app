import assert from 'node:assert/strict'
import { test } from 'node:test'
import { alignRows, changedRanges, countChanges } from '../review/diff.ts'

const file = (...lines: string[]) => `${lines.join('\n')}\n`
const shape = (base: string, head: string) =>
  alignRows(base, head).map((row) => [row.kind, row.oldLine ?? null, row.newLine ?? null, row.oldText, row.newText])

// Ported from pi-coder's diff tests: the same rows, built with the `diff` package.
test('an unchanged file is all equal rows', () => {
  assert.deepEqual(shape(file('alpha', 'beta'), file('alpha', 'beta')), [
    ['equal', 1, 1, 'alpha', 'alpha'],
    ['equal', 2, 2, 'beta', 'beta'],
  ])
  assert.deepEqual(countChanges(alignRows(file('alpha'), file('alpha'))), { additions: 0, deletions: 0 })
})

test('a changed line pairs its old and new text in one row', () => {
  assert.deepEqual(shape(file('alpha', 'old value', 'omega'), file('alpha', 'new value', 'omega')), [
    ['equal', 1, 1, 'alpha', 'alpha'],
    ['replace', 2, 2, 'old value', 'new value'],
    ['equal', 3, 3, 'omega', 'omega'],
  ])
})

test('line numbers hold when a group loses or gains lines', () => {
  const rows = alignRows(file('alpha', 'old a', 'old b', 'omega'), file('alpha', 'new a', 'omega'))
  assert.deepEqual(
    rows.map((row) => [row.kind, row.oldLine ?? null, row.newLine ?? null]),
    [
      ['equal', 1, 1],
      ['replace', 2, 2],
      ['delete', 3, null],
      ['equal', 4, 3],
    ],
  )
  assert.deepEqual(countChanges(rows), { additions: 1, deletions: 2 })

  assert.deepEqual(
    alignRows(file('a', 'z'), file('a', 'b', 'c', 'z')).map((row) => [row.kind, row.oldLine ?? null, row.newLine ?? null]),
    [
      ['equal', 1, 1],
      ['insert', null, 2],
      ['insert', null, 3],
      ['equal', 2, 4],
    ],
  )
})

test('an added file is all inserts and a deleted file all deletes', () => {
  assert.deepEqual(shape('', file('one', 'two')), [
    ['insert', null, 1, '', 'one'],
    ['insert', null, 2, '', 'two'],
  ])
  assert.deepEqual(shape(file('one'), ''), [['delete', 1, null, 'one', '']])
})

test('a change to the final newline or to line endings counts as a change, as git shows it', () => {
  assert.deepEqual(shape('alpha\nbeta', 'alpha\nbeta\n'), [
    ['equal', 1, 1, 'alpha', 'alpha'],
    ['replace', 2, 2, 'beta', 'beta'],
  ])
  assert.deepEqual(shape('alpha\r\nbeta\r\n', 'alpha\r\ngamma\r\n'), [
    ['equal', 1, 1, 'alpha', 'alpha'],
    ['replace', 2, 2, 'beta', 'gamma'],
  ])
  assert.deepEqual(countChanges(alignRows('one\r\n', 'one\n')), { additions: 1, deletions: 1 })
})

test('changed ranges list each side, merging lines that touch', () => {
  const rows = alignRows(file('a', 'b', 'c', 'd', 'e', 'f', 'g'), file('a', 'B', 'C', 'd', 'e', 'g', 'h'))
  assert.deepEqual(changedRanges('f1', rows), [
    { fileId: 'f1', side: 'deleted', startLine: 2, endLine: 3 },
    { fileId: 'f1', side: 'added', startLine: 2, endLine: 3 },
    { fileId: 'f1', side: 'deleted', startLine: 6, endLine: 6 },
    { fileId: 'f1', side: 'added', startLine: 7, endLine: 7 },
  ])
})
