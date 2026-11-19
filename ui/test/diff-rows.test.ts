import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONTEXT_LINES, EXPAND_BY, describeFile, diffFromPatch, diffOf, expandGap, showWholeFile, splitRows, startView, unifiedRows, type DiffItem, type SplitItem } from '../src/features/review/code/diff-rows.ts'

const numbered = (count: number, change: Record<number, string> = {}) => Array.from({ length: count }, (_, index) => change[index + 1] ?? `line ${index + 1}`).join('\n') + '\n'
const lines = (items: readonly DiffItem[]) => items.filter((item) => item.type === 'line')
const gaps = (items: readonly DiffItem[]) => items.filter((item) => item.type === 'gap')
const shape = (items: readonly DiffItem[]) =>
  items.map((item) => (item.type === 'gap' ? `gap ${item.hidden}` : `${item.line.marker}${item.line.oldLine ?? ''}:${item.line.newLine ?? ''} ${item.line.text}`))

test('builds rows with line numbers, markers and changed words', () => {
  const base = ['const a = 1', 'function total(items) {', '  return items.length', '}', 'export { total }'].join('\n') + '\n'
  const head = ['const a = 1', 'function total(items, tax) {', '  return items.length * tax', '}', 'const b = 2', 'export { total }'].join('\n') + '\n'
  const diff = diffOf(base, head)
  const rows = unifiedRows(diff, startView(diff))

  assert.deepEqual([diff.additions, diff.deletions], [3, 2])
  // Unchanged lines carry both numbers. A change shows what was removed first, then what was added.
  assert.deepEqual(shape(rows), [
    ' 1:1 const a = 1',
    '-2: function total(items) {',
    '-3:   return items.length',
    '+:2 function total(items, tax) {',
    '+:3   return items.length * tax',
    ' 4:4 }',
    '+:5 const b = 2',
    ' 5:6 export { total }',
  ])
  assert.deepEqual(lines(rows).map((item) => item.type === 'line' && item.line.kind), ['context', 'removed', 'removed', 'added', 'added', 'context', 'added', 'context'])

  // The words that changed inside a line are marked, so they can be tinted more strongly than the line.
  const word = (text: string) => {
    const item = rows.find((entry) => entry.type === 'line' && entry.line.text === text)
    assert.ok(item && item.type === 'line')
    return item.line.words.map(({ start, end }) => text.slice(start, end))
  }
  assert.deepEqual(word('function total(items, tax) {'), [', tax'])
  assert.deepEqual(word('function total(items) {'), [])
  assert.deepEqual(word('  return items.length * tax'), [' * tax'])
  // A line that is new, with nothing it replaced, has no words to single out.
  assert.deepEqual(word('const b = 2'), [])

  // Lines that share almost nothing are a rewrite: marking every word would say less than the line's own tint.
  const rewrite = unifiedRows(diffOf('const alpha = compute(first)\n', 'await writeFile(target, text)\n'), startView(diffOf('const alpha = compute(first)\n', 'await writeFile(target, text)\n')))
  assert.deepEqual(rewrite.flatMap((item) => (item.type === 'line' ? item.line.words : [])), [])

  // Two columns: the old side on the left, the new on the right, row by row.
  const split = splitRows(diff, startView(diff))
  const cells = (items: readonly SplitItem[]) => items.map((item) => (item.type === 'gap' ? 'gap' : `${item.left ? `${item.left.marker}${item.left.oldLine}` : ''}|${item.right ? `${item.right.marker}${item.right.newLine}` : ''}`))
  assert.deepEqual(cells(split), [' 1| 1', '-2|+2', '-3|+3', ' 4| 4', '|+5', ' 5| 6'])
})

test('shows three lines of context and expands by twenty', () => {
  assert.deepEqual([CONTEXT_LINES, EXPAND_BY], [3, 20])
  const diff = diffOf(numbered(100), numbered(100, { 10: 'changed 10', 70: 'changed 70' }))
  let view = startView(diff)
  let rows = unifiedRows(diff, view)

  // Three unchanged lines on each side of each group, and a gap wherever lines are held back.
  const visible = () => lines(rows).map((item) => item.type === 'line' && (item.line.newLine ?? `-${item.line.oldLine}`))
  assert.deepEqual(visible(), [7, 8, 9, '-10', 10, 11, 12, 13, 67, 68, 69, '-70', 70, 71, 72, 73])
  assert.deepEqual(gaps(rows).map((item) => item.type === 'gap' && [item.hidden, item.above, item.below]), [
    [6, true, false],
    [53, true, true],
    [27, false, true],
  ])

  // "Show more" below the first group reveals twenty more lines, and only there.
  const middle = gaps(rows)[1]!
  assert.ok(middle.type === 'gap')
  view = expandGap(view, middle.id, 'below')
  rows = unifiedRows(diff, view)
  assert.deepEqual(visible().slice(8, 28), Array.from({ length: 20 }, (_, index) => 14 + index))
  assert.deepEqual(gaps(rows).map((item) => item.type === 'gap' && item.hidden), [6, 33, 27])

  // "Show more" above the second group takes twenty from the other end of the same gap.
  view = expandGap(view, middle.id, 'above')
  rows = unifiedRows(diff, view)
  assert.deepEqual(gaps(rows).map((item) => item.type === 'gap' && item.hidden), [6, 13, 27])
  assert.ok(visible().includes(47) && !visible().includes(46))

  // When what is left is no more than one press, the gap closes.
  view = expandGap(view, middle.id, 'below')
  rows = unifiedRows(diff, view)
  assert.equal(gaps(rows).length, 2)

  // At the top of the file there is only more above, and six lines is all there is.
  const top = gaps(rows)[0]!
  assert.ok(top.type === 'gap')
  rows = unifiedRows(diff, expandGap(view, top.id, 'above'))
  assert.deepEqual(visible().slice(0, 3), [1, 2, 3])

  // "Whole file" shows every line.
  rows = unifiedRows(diff, showWholeFile(view))
  assert.equal(gaps(rows).length, 0)
  assert.equal(lines(rows).length, 102)

  // Two groups closer than their context share it and leave no gap between them.
  const close = diffOf(numbered(30), numbered(30, { 10: 'changed 10', 15: 'changed 15' }))
  assert.equal(gaps(unifiedRows(close, startView(close))).length, 2)
})

test('lines a node points at are shown with their surroundings, changed or not', () => {
  // An unchanged file, as for a context node: nothing changed, so only what is pointed at shows.
  const text = numbered(60)
  const diff = diffOf(text, text)
  const view = startView(diff, [{ side: 'added', startLine: 30, endLine: 32 }])
  const rows = unifiedRows(diff, view)

  assert.deepEqual(lines(rows).map((item) => item.type === 'line' && item.line.newLine), [27, 28, 29, 30, 31, 32, 33, 34, 35])
  assert.deepEqual(lines(rows).map((item) => item.type === 'line' && item.line.emphasis), [false, false, false, true, true, true, false, false, false])

  // In a changed file the lines of the step are marked.
  const changed = diffOf(numbered(40), numbered(40, { 5: 'changed 5', 30: 'changed 30' }))
  const marked = unifiedRows(changed, startView(changed, [{ side: 'added', startLine: 30, endLine: 30 }]))
  const emphasis = Object.fromEntries(lines(marked).flatMap((item) => (item.type === 'line' && item.line.kind !== 'context' ? [[`${item.line.marker}${item.line.oldLine ?? item.line.newLine}`, item.line.emphasis]] : [])))
  assert.deepEqual(emphasis, { '-30': false, '+30': true })
})

test('a node\'s code opens on its own lines, with the file\'s other changes folded away', () => {
  const changed = diffOf(numbered(200), numbered(200, { 5: 'changed 5', 150: 'changed 150' }))
  const pointed = [{ side: 'added' as const, startLine: 150, endLine: 150 }]
  const rows = unifiedRows(changed, startView(changed, pointed))
  assert.equal(rows[0]!.type, 'gap')
  assert.equal(rows.findIndex((item) => item.type === 'line' && item.line.emphasis), 5)
  assert.deepEqual(lines(rows).map((item) => item.type === 'line' && item.line.newLine).filter(Boolean).slice(0, 3), [147, 148, 149])
  assert.ok(!lines(rows).some((item) => item.type === 'line' && item.line.newLine === 5))

  // Nothing pointed at: every change shows.
  assert.equal(shape(unifiedRows(changed, startView(changed))).filter((row) => row.startsWith('+')).length, 2)

  // The whole file shows every change, the node's marked and the other unmarked.
  const whole = unifiedRows(changed, showWholeFile(startView(changed, pointed)))
  assert.equal(lines(whole).length, 202)
  const marks = lines(whole).flatMap((item) => (item.type === 'line' && item.line.kind === 'added' ? [item.line.emphasis] : []))
  assert.deepEqual(marks, [false, true])

  // A node whose lines hold no change shows only its lines, with their surroundings.
  const none = unifiedRows(changed, startView(changed, [{ side: 'added', startLine: 80, endLine: 81 }]))
  assert.deepEqual(lines(none).map((item) => item.type === 'line' && item.line.newLine), [77, 78, 79, 80, 81, 82, 83, 84])
})

test('handles added, deleted, renamed and binary files', () => {
  const text = 'one\ntwo\nthree\n'

  // An added file: every line is added, numbered on the new side, with nothing held back.
  const added = diffOf(null, text)
  assert.deepEqual(shape(unifiedRows(added, startView(added))), ['+:1 one', '+:2 two', '+:3 three'])
  assert.deepEqual(describeFile({ path: 'src/new.ts', base: null, head: text, binary: false }), { kind: 'added', title: 'src/new.ts', note: null })

  // A deleted file: every line is removed, numbered on the old side.
  const deleted = diffOf(text, null)
  assert.deepEqual(shape(unifiedRows(deleted, startView(deleted))), ['-1: one', '-2: two', '-3: three'])
  assert.deepEqual(describeFile({ path: 'src/old.ts', base: text, head: null, binary: false }), { kind: 'deleted', title: 'src/old.ts', note: null })

  // A renamed file names both paths. With no line changed, it says so instead of showing an empty diff.
  assert.deepEqual(describeFile({ path: 'src/new-name.ts', oldPath: 'src/old-name.ts', base: text, head: text, binary: false }), {
    kind: 'renamed',
    title: 'src/old-name.ts → src/new-name.ts',
    note: 'Renamed. Its contents did not change.',
  })
  const renamedAndChanged = describeFile({ path: 'b.ts', oldPath: 'a.ts', base: text, head: 'one\n2\nthree\n', binary: false })
  assert.deepEqual([renamedAndChanged.kind, renamedAndChanged.title, renamedAndChanged.note], ['renamed', 'a.ts → b.ts', null])

  // A binary file is named, and a line says its contents are not shown.
  assert.deepEqual(describeFile({ path: 'assets/logo.png', base: null, head: null, binary: true }), {
    kind: 'binary',
    title: 'assets/logo.png',
    note: 'A binary file. Its contents are not shown.',
  })
  const binary = diffOf(null, null)
  assert.deepEqual(unifiedRows(binary, startView(binary)), [])

  // An empty file that was added has no lines either, and says why.
  assert.equal(describeFile({ path: 'empty.txt', base: null, head: '', binary: false }).note, 'An empty file.')
  assert.equal(describeFile({ path: 'same.txt', base: text, head: text, binary: false }).kind, 'unchanged')
})

test('reads a patch when only a patch is at hand', () => {
  const patch = ['--- a/src/doing.mjs', '+++ b/src/doing.mjs', '@@ -4,5 +4,6 @@', ' function a() {', '-  return 1', '+  return 2', '+  // twice', ' }', ' ', ' function b() {', '@@ -40,3 +41,3 @@ function z() {', ' x', '-y', '+Y', ' z'].join('\n')
  const diff = diffFromPatch(patch)
  const rows = unifiedRows(diff, startView(diff))

  assert.deepEqual([diff.additions, diff.deletions, diff.partial], [3, 2, true])
  assert.deepEqual(shape(rows), [
    'gap 3',
    ' 4:4 function a() {',
    '-5:   return 1',
    '+:5   return 2',
    '+:6   // twice',
    ' 6:7 }',
    ' 7:8 ',
    ' 8:9 function b() {',
    'gap 31',
    ' 40:41 x',
    '-41: y',
    '+:42 Y',
    ' 42:43 z',
  ])
  // A patch does not hold the lines between its hunks, so those gaps cannot be opened.
  assert.ok(gaps(rows).every((item) => item.type === 'gap' && !item.above && !item.below))
})
