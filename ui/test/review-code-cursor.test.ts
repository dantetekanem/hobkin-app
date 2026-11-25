import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diffFromPatch, diffOf, lineNumberOn, linesIn, revealLines, rowOfLine, splitRows, startView, unifiedRows, type DiffItem, type DiffView, type SplitItem } from '../src/features/review/code/diff-rows.ts'
import {
  changeAt,
  changesOf,
  clicked,
  columnMoved,
  firstChange,
  lastChange,
  lineAt,
  moved,
  paged,
  rangeOf,
  rowsOf,
  snapped,
  stableScroll,
  toChange,
  type Cursor,
} from '../src/features/review/diff/cursor.ts'

/**
 * Forty lines, with three groups of changes far apart: line 5 changed and 6 and 7 removed; two lines added after 20; and
 * line 35 changed. In the new file line 5 is the changed one, 6 to 18 are old 8 to 20, 19 and 20 are new, and from 21 on
 * the numbers agree again.
 */
const base = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`)
const head = [...base.slice(0, 4), 'changed 5', ...base.slice(7, 20), 'new A', 'new B', ...base.slice(20, 34), 'changed 35', ...base.slice(35)]
const diff = diffOf(`${base.join('\n')}\n`, `${head.join('\n')}\n`)
const start = startView(diff)

/** A cursor as it reads: `-5` a removed line, `+5` an added one, ` 6` an unchanged line by its new number, `old 8` by its old. */
const at = (cursor: Pick<Cursor, 'side' | 'line'> | null | undefined) => (cursor == null ? null : `${cursor.side === 'deleted' ? '-' : '+'}${cursor.line}`)
const single = (side: Cursor['side'], line: number, column: Cursor['column'] = side === 'deleted' ? 'old' : 'new'): Cursor => ({ side, line, anchor: line, column })
/** Every place the cursor goes with one key pressed again and again, from where it starts. */
function walk(view: DiffView, split: boolean, from: Cursor, delta: 1 | -1, how: { lines?: boolean; extend?: boolean } = {}) {
  const places: string[] = []
  let cursor = from
  let shown = view
  for (let step = 0; step < 60; step += 1) {
    const next = moved(diff, shown, split, cursor, delta, how)
    if (!next) break
    cursor = next.cursor
    shown = next.view
    places.push(how.extend ? `${at(cursor)} from ${cursor.anchor}` : at(cursor)!)
  }
  return { places, cursor, view: shown }
}
const shownNew = (items: readonly (DiffItem | SplitItem)[]) =>
  items.flatMap((item) => (item.type === 'line' ? [item.line] : item.type === 'row' ? [item.right ?? item.left!] : [])).map((line) => line.newLine ?? `-${line.oldLine}`)
const hidden = (items: readonly (DiffItem | SplitItem)[]) => items.flatMap((item) => (item.type === 'gap' ? [item.hidden] : []))

test('a file opens on its first changed line: in one column a removed line comes first, in two the new side of its row', () => {
  assert.deepEqual(firstChange(rowsOf(diff, start, false), false), single('deleted', 5))
  assert.deepEqual(firstChange(rowsOf(diff, start, true), true), single('added', 5))
  // End goes to the last changed line.
  assert.deepEqual(lastChange(rowsOf(diff, start, false), false), single('added', 35))
  assert.deepEqual(lastChange(rowsOf(diff, start, true), true), single('added', 35))
  // A file with no change opens on its first line, and one with no lines has no cursor.
  const same = diffOf('a\nb\n', 'a\nb\n')
  assert.equal(at(firstChange(rowsOf(same, startView(same), false), false)), '+1')
  const empty = diffOf(null, '')
  assert.equal(firstChange(rowsOf(empty, startView(empty), false), false), null)
})

test('Up and Down go through changed lines only, in the order they are drawn, and stop at the ends', () => {
  const down = walk(start, false, single('deleted', 5), 1)
  assert.deepEqual(down.places, ['-6', '-7', '+5', '+19', '+20', '-35', '+35'])
  assert.deepEqual(walk(start, false, single('added', 35), -1).places, ['-35', '+20', '+19', '+5', '-7', '-6', '-5'])
  assert.equal(down.view, start, 'nothing opens')

  // In two columns each column is walked on its own: the old side's removed lines, the new side's added ones.
  assert.deepEqual(walk(start, true, single('added', 5), 1).places, ['+19', '+20', '+35'])
  assert.deepEqual(walk(start, true, single('deleted', 5), 1).places, ['-6', '-7', '-35'])
  assert.equal(walk(start, true, single('deleted', 6), 1).cursor.column, 'old')
})

test('Option with Up and Down reaches every line, opening the unchanged lines it comes to one at a time', () => {
  // From the last line before the first gap, each press opens one more line of it.
  const from = single('added', 8)
  const first = moved(diff, start, false, from, 1, { lines: true })!
  assert.equal(at(first.cursor), '+9')
  assert.deepEqual(hidden(unifiedRows(diff, first.view)), [1, 6, 8, 2], 'the gap under it is one line shorter')
  const down = walk(start, false, from, 1, { lines: true })
  assert.deepEqual(down.places.slice(0, 10), ['+9', '+10', '+11', '+12', '+13', '+14', '+15', '+16', '+17', '+18'])
  assert.ok(down.places.includes('+40') && down.places.at(-1) === '+40', 'it goes on to the last line of the file')
  assert.deepEqual(hidden(unifiedRows(diff, down.view)), [1], 'only the line above the first change is still held back')

  // Up from the first line drawn opens the line above it, at the top of the file.
  const up = moved(diff, start, false, single('added', 2), -1, { lines: true })!
  assert.equal(at(up.cursor), '+1')
  assert.deepEqual(hidden(unifiedRows(diff, up.view)), [7, 8, 2])
  assert.equal(moved(diff, up.view, false, up.cursor, -1, { lines: true }), null, 'nothing above the first line')

  // In one column an unchanged line is reached by its new number, and a removed line by its old.
  assert.deepEqual(walk(start, false, single('deleted', 5), 1, { lines: true }).places.slice(0, 4), ['-6', '-7', '+5', '+6'])
})

test('Shift selects from where the selection started, on one side of the file only', () => {
  // From a removed line, the selection grows through removed lines, and passes over the added and unchanged ones.
  const grown = walk(start, false, single('deleted', 5), 1, { extend: true })
  assert.deepEqual(grown.places, ['-6 from 5', '-7 from 5', '-35 from 5'])
  assert.deepEqual(rangeOf(grown.cursor), { side: 'deleted', startLine: 5, endLine: 35 })
  // Back up, it shrinks to its start, and goes on past it the other way.
  const back = walk(start, false, grown.cursor, -1, { extend: true })
  assert.deepEqual(back.places, ['-7 from 5', '-6 from 5', '-5 from 5'])
  assert.equal(moved(diff, start, false, single('deleted', 5), -1, { extend: true }), null, 'nothing above it on its side')

  // From an unchanged line, the new side.
  assert.deepEqual(walk(start, false, single('added', 7), 1, { extend: true }).places, ['+19 from 7', '+20 from 7', '+35 from 7'])

  // Option with Shift selects through every line of its side, opening what it comes to: never an added line here.
  const through = walk(start, false, single('deleted', 7), 1, { extend: true, lines: true })
  assert.deepEqual(through.places.slice(0, 4), ['-8 from 7', '-9 from 7', '-10 from 7', '-11 from 7'])
  assert.deepEqual(rangeOf(through.cursor), { side: 'deleted', startLine: 7, endLine: 40 })

  // In two columns, a selection started on an unchanged line in the old column is on the old side.
  const old = moved(diff, start, true, single('added', 7, 'old'), 1, { extend: true })!
  assert.deepEqual(old.cursor, { side: 'deleted', line: 35, anchor: 9, column: 'old' })
})

test('J and K go to the next and previous group of changes, and the cursor says which it is in', () => {
  assert.deepEqual(changesOf(diff), [{ start: 4, end: 6 }, { start: 20, end: 21 }, { start: 36, end: 36 }])
  const second = toChange(diff, false, single('deleted', 5), 1)!
  assert.equal(at(second), '+19')
  assert.equal(at(toChange(diff, false, second, 1)), '-35', 'in one column a changed line starts with what it replaced')
  assert.equal(at(toChange(diff, true, second, 1)), '+35', 'in two columns, on the side the cursor is on')
  assert.equal(toChange(diff, false, single('added', 35), 1), null, 'after the last, nowhere')
  assert.equal(at(toChange(diff, false, single('added', 35), -1)), '+19')
  // From the middle of a group, K goes to the group before it.
  assert.equal(at(toChange(diff, false, single('deleted', 7), -1)), null)
  assert.equal(at(toChange(diff, false, single('added', 20), -1)), '-5')
  // From unchanged lines, J and K go to the groups on either side.
  assert.equal(at(toChange(diff, false, single('added', 25), 1)), '-35')
  assert.equal(at(toChange(diff, false, single('added', 25), -1)), '+19')

  assert.deepEqual(changeAt(diff, single('added', 20)), { index: 1, total: 3, inside: true })
  assert.deepEqual(changeAt(diff, single('added', 25)), { index: 1, total: 3, inside: false })
  assert.deepEqual(changeAt(diff, single('added', 2)), { index: -1, total: 3, inside: false })

  // Changes closer than their context are one group, as they are drawn in one piece.
  const close = diffOf('1\n2\n3\n4\n5\n6\n7\n8\n9\n', '1\nB\n3\n4\n5\n6\n7\nH\n9\n')
  assert.deepEqual(changesOf(close), [{ start: 1, end: 7 }])
})

test('in two columns Left and Right move between the old side and the new on the same row, or the nearest one', () => {
  const rows = rowsOf(diff, start, true)
  assert.deepEqual(columnMoved(rows, single('added', 5), 'old'), single('deleted', 5))
  assert.deepEqual(columnMoved(rows, single('deleted', 6), 'new'), single('added', 5, 'new'), 'a removed line with nothing beside it goes to the nearest row with a new side')
  assert.deepEqual(columnMoved(rows, single('added', 19), 'old'), single('added', 18, 'old'))
  // An unchanged line is the same line in both columns.
  assert.deepEqual(columnMoved(rows, single('added', 7), 'old'), single('added', 7, 'old'))
})

test('Page Down moves a page of lines, and a cursor no longer drawn goes to the nearest line', () => {
  const rows = rowsOf(diff, start, false)
  assert.equal(at(paged(rows, false, single('deleted', 5), 1, 4)), '+6')
  assert.equal(at(paged(rows, false, single('added', 38), 1, 10)), '+38', 'the last line drawn is as far as it goes')
  assert.equal(at(paged(rows, false, single('deleted', 6), -1, 10)), '+2')

  // Line 12 is held back in the first gap: the cursor goes to the next line drawn, else the last before it.
  assert.deepEqual(snapped(rows, single('added', 12)), single('added', 16))
  assert.deepEqual(snapped(rows, single('added', 40)), single('added', 38))
  const kept: Cursor = { side: 'deleted', line: 7, anchor: 5, column: 'old' }
  assert.equal(snapped(rows, kept), kept, 'one that is drawn stays as it is')
})

test('lines of one side are opened from the nearer end of the gap they are in, and a line is found by its row', () => {
  // New lines 12 to 14 are in the first gap, which holds new 9 to 15: three lines from its bottom are fewer than six from its top.
  const opened = revealLines(diff, start, 'added', 12, 14)
  const items = unifiedRows(diff, opened)
  assert.deepEqual(hidden(items), [1, 3, 8, 2])
  assert.ok([12, 13, 14, 15].every((line) => shownNew(items).includes(line)) && !shownNew(items).includes(11))
  assert.equal(revealLines(diff, opened, 'added', 12, 14), opened, 'lines already drawn open nothing')
  // A range across two gaps opens both, the one at the top of the file from its bottom, as nothing is above it.
  assert.deepEqual(hidden(unifiedRows(diff, revealLines(diff, start, 'deleted', 1, 20))), [8, 2])
  // The lines between a patch's hunks are not known, so nothing opens.
  const patch = diffFromPatch('--- a/f\n+++ b/f\n@@ -10,2 +10,2 @@\n a\n-b\n+c\n')
  const patchView = startView(patch)
  assert.equal(revealLines(patch, patchView, 'added', 1, 3), patchView)

  // An unchanged line is on both sides, a removed line on the old one only.
  const unified = rowsOf(diff, start, false)
  const context = unified[rowOfLine(unified, 'deleted', 8)]
  assert.ok(context?.type === 'line' && context.line.kind === 'context' && lineNumberOn(context.line, 'added') === 6)
  assert.equal(rowOfLine(unified, 'added', 12), -1)
  const split = splitRows(diff, start)
  const row = split[rowOfLine(split, 'added', 5)]
  assert.ok(row?.type === 'row' && row.left?.oldLine === 5, 'in two columns a changed line shares its row with what it replaced')
  assert.equal(lineNumberOn({ kind: 'removed', marker: '-', oldLine: 3, text: '', words: [], emphasis: false }, 'added'), undefined)
})

test('a click on a line number puts the cursor there, and with Shift moves the end of the selection along its side', () => {
  const rows = rowsOf(diff, start, false)
  const lineOf = (side: Cursor['side'], number: number) => linesIn(rows[rowOfLine(rows, side, number)]!).find((line) => lineNumberOn(line, side) === number)!
  assert.deepEqual(clicked(single('deleted', 5), lineOf('added', 19), 'new', false, false), single('added', 19))
  assert.deepEqual(clicked(single('deleted', 5), lineOf('deleted', 8), 'old', true, false), { side: 'deleted', line: 8, anchor: 5, column: 'old' })
  // An added line is not on the old side: Shift with a click on one starts a selection there.
  assert.deepEqual(clicked(single('deleted', 5), lineOf('added', 19), 'new', true, false), single('added', 19))
  // The cursor's line is found by its number on its side: old line 8 is unchanged.
  assert.deepEqual([lineAt(rows, single('deleted', 8))?.kind, lineAt(rows, single('deleted', 8))?.newLine], ['context', 6])
})

test('the view stays still while the cursor is in it, and centers it when it leaves', () => {
  assert.equal(stableScroll(100, 300, 150, 172), 100)
  assert.equal(stableScroll(100, 300, 500, 522), 361)
  assert.equal(stableScroll(400, 300, 100, 122), 0)
  // Taller than the view: its top.
  assert.equal(stableScroll(100, 300, 500, 900), 500)
})
