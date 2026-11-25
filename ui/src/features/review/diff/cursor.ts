/**
 * The code view's cursor (spec 071): the moves pi-coder's `/diff` makes over a file's diff, as `code/diff-rows.ts` draws
 * it in one column or two. Up and Down go from changed line to changed line. Option with them reaches every line and
 * opens the unchanged lines it comes to. Shift selects from where the selection started, on one side of the file only.
 * J and K go from group to group of changes, and the view keeps the cursor in sight. Pure, so every move is tested
 * without a screen.
 */
import {
  CONTEXT_LINES,
  lineNumberOn,
  linesIn,
  revealLines,
  rowOfLine,
  splitRows,
  unifiedRows,
  type Diff,
  type DiffItem,
  type DiffLine,
  type DiffView,
  type Emphasis,
  type SplitItem,
} from '../code/diff-rows.ts'

export type Side = Emphasis['side']
/** In two columns, the column the cursor walks: the old side at the left, the new at the right. */
export type Column = 'old' | 'new'
export type Rows = readonly (DiffItem | SplitItem)[]

/**
 * Where the cursor is: a line of one side of the file, and the line of that side the selection started from, the
 * cursor's own when nothing more is selected. A line on its own is on the side the review gives it: a removed line on
 * the old side, any other on the new. In two columns `column` is the column it walks.
 */
export interface Cursor {
  side: Side
  line: number
  anchor: number
  column: Column
}

/** A line of a row and the column it is drawn in. In one column a removed line is the old side's, any other the new side's. */
interface Cell {
  line: DiffLine
  column: Column
}

/** The column a line is in when the diff is drawn in one: a removed line is the old side's, any other the new side's. */
const columnOf = (line: DiffLine): Column => (line.kind === 'removed' ? 'old' : 'new')

function cellsOf(item: DiffItem | SplitItem): Cell[] {
  if (item.type === 'line') return [{ line: item.line, column: columnOf(item.line) }]
  if (item.type !== 'row') return []
  const cells: Cell[] = []
  if (item.left) cells.push({ line: item.left, column: 'old' })
  if (item.right) cells.push({ line: item.right, column: 'new' })
  return cells
}

const changed = (line: DiffLine) => line.kind !== 'context'

/** The rows a view of a diff draws, in one column or two. */
export const rowsOf = (diff: Diff, view: DiffView, split: boolean): Rows => (split ? splitRows(diff, view) : unifiedRows(diff, view))

/** The cursor on one line, with nothing more selected, on the side the review gives that line. */
export function cursorOn(line: DiffLine, column: Column): Cursor {
  const side: Side = line.kind === 'removed' ? 'deleted' : 'added'
  const number = (side === 'deleted' ? line.oldLine : line.newLine) ?? 0
  return { side, line: number, anchor: number, column }
}

/** The lines selected: from where the selection started to the cursor's line, on their side. */
export function rangeOf(cursor: Cursor): Emphasis {
  return { side: cursor.side, startLine: Math.min(cursor.anchor, cursor.line), endLine: Math.max(cursor.anchor, cursor.line) }
}

/** The line the cursor is on, as drawn in its column. */
export function lineAt(rows: Rows, cursor: Cursor): DiffLine | undefined {
  const row = rows[rowOfLine(rows, cursor.side, cursor.line)]
  const cells = row ? cellsOf(row).filter((cell) => lineNumberOn(cell.line, cursor.side) === cursor.line) : []
  return (cells.find((cell) => cell.column === cursor.column) ?? cells[0])?.line
}

/** The first changed line of the rows taken in `order`, in two columns the new side of its row when it has one; with no change, the first line. */
function edge(rows: Rows, split: boolean, order: readonly number[]): Cursor | null {
  const first = (wanted: (line: DiffLine) => boolean): Cursor | null => {
    for (const index of order) {
      const cells = cellsOf(rows[index]!).filter((cell) => wanted(cell.line))
      const cell = (split ? cells.find((each) => each.column === 'new') : undefined) ?? cells[0]
      if (cell) return cursorOn(cell.line, cell.column)
    }
    return null
  }
  return first(changed) ?? first(() => true)
}

/** Where a file opens, and Home: its first changed line as drawn. In two columns, the new side of that row when it has one. */
export const firstChange = (rows: Rows, split: boolean): Cursor | null => edge(rows, split, rows.map((_, index) => index))

/** End: the last changed line as drawn. */
export const lastChange = (rows: Rows, split: boolean): Cursor | null => edge(rows, split, rows.map((_, index) => rows.length - 1 - index))

/** The cursor a file shows: the one it kept, on the nearest line drawn when its own is not, else the file's first changed line. */
export function cursorIn(rows: Rows, split: boolean, kept: Cursor | null): Cursor | null {
  const drawn = kept ? snapped(rows, kept) : null
  return drawn ?? firstChange(rows, split)
}

export interface Moved {
  view: DiffView
  cursor: Cursor
}

/**
 * Up and Down, as `delta` -1 and 1: the next changed line as drawn, in two columns in the cursor's column. `lines`
 * (Option) reaches every line, and opens the unchanged line it comes to when a gap holds it back. `extend` (Shift) moves
 * the cursor's end of the selection only, through the lines of the selection's own side: in two columns, a selection
 * started on an unchanged line is on the side of its column. Null where there is nowhere to go.
 */
export function moved(diff: Diff, view: DiffView, split: boolean, cursor: Cursor, delta: 1 | -1, { lines = false, extend = false } = {}): Moved | null {
  let rows = rowsOf(diff, view, split)
  const from = rowOfLine(rows, cursor.side, cursor.line)
  if (from < 0) return null

  const { side, anchor } = extend ? selectionStart(rows[from]!, split, cursor) : cursor
  // The cursor's line, numbered on the side it moves along.
  const here = side === cursor.side ? cursor.line : anchor

  let shown = view
  if (lines && rows[from + delta]?.type === 'gap') {
    shown = revealLines(diff, view, side, here + delta, here + delta)
    rows = rowsOf(diff, shown, split)
  }

  const walked = (cell: Cell) => (!split || cell.column === cursor.column) && (lines || changed(cell.line))
  for (let index = rowOfLine(rows, side, here) + delta; index >= 0 && index < rows.length; index += delta) {
    for (const cell of cellsOf(rows[index]!).filter(walked)) {
      if (!extend) return { view: shown, cursor: cursorOn(cell.line, split ? cursor.column : cell.column) }
      const number = lineNumberOn(cell.line, side)
      if (number != null) return { view: shown, cursor: { side, line: number, anchor, column: cursor.column } }
    }
  }
  return null
}

/**
 * Where a selection grows from, and along which side. One under way keeps its own. One that starts now, from the cursor's
 * line alone, is on the cursor's side, or in two columns on the side of the cursor's column, as an unchanged line is on both.
 */
function selectionStart(row: DiffItem | SplitItem, split: boolean, cursor: Cursor): Pick<Cursor, 'side' | 'anchor'> {
  if (!split || cursor.anchor !== cursor.line) return cursor
  const side: Side = cursor.column === 'old' ? 'deleted' : 'added'
  const own = cellsOf(row).find((cell) => cell.column === cursor.column)
  const anchor = own ? lineNumberOn(own.line, side) : undefined
  return anchor == null ? cursor : { side, anchor }
}

/** Page Up and Page Down: `count` lines on, of any kind, in two columns in the cursor's column, as far as the lines drawn go. */
export function paged(rows: Rows, split: boolean, cursor: Cursor, delta: 1 | -1, count: number): Cursor {
  let reached = cursor
  let moves = 0
  for (let index = rowOfLine(rows, cursor.side, cursor.line) + delta; index >= 0 && index < rows.length; index += delta) {
    if (moves === count) break
    const cell = cellsOf(rows[index]!).find((each) => !split || each.column === cursor.column)
    if (!cell) continue
    reached = cursorOn(cell.line, split ? cursor.column : cell.column)
    moves += 1
  }
  return reached
}

/** The groups of changes, by row of the diff, as the view draws them: changes closer together than their context are one group. */
export function changesOf(diff: Diff): { start: number; end: number }[] {
  const groups: { start: number; end: number }[] = []
  for (const group of diff.groups) {
    const last = groups.at(-1)
    if (last && group.start - last.end - 1 <= CONTEXT_LINES * 2) last.end = group.end
    else groups.push({ ...group })
  }
  return groups
}

/** The row of the diff that holds a cursor's line. */
function diffRowOf(diff: Diff, cursor: Pick<Cursor, 'side' | 'line'>): number {
  return diff.rows.findIndex((row) => {
    if (cursor.side === 'added') return row.kind !== 'delete' && row.newLine === cursor.line
    return row.kind !== 'insert' && row.oldLine === cursor.line
  })
}

/**
 * J and K: the first line of the next or the previous group of changes, as drawn, from wherever the cursor is, a group
 * or the unchanged lines between two; in two columns on the cursor's side when that row has a change there. Null when
 * there is none that way.
 */
export function toChange(diff: Diff, split: boolean, cursor: Cursor, delta: 1 | -1): Cursor | null {
  const row = diffRowOf(diff, cursor)
  const groups = changesOf(diff)
  const group = delta > 0 ? groups.find((each) => each.start > row) : groups.findLast((each) => each.end < row)
  if (!group) return null
  const first = diff.rows[group.start]!
  const removes = first.kind !== 'insert'
  const adds = first.kind !== 'delete'
  // As drawn in one column, and in the old column, a group starts with what it removed; in the new column, with what it added.
  const onOld = split && cursor.column === 'new' ? !adds : removes
  const line = (onOld ? first.oldLine : first.newLine) ?? 0
  return { side: onOld ? 'deleted' : 'added', line, anchor: line, column: onOld ? 'old' : 'new' }
}

/** Which group of changes the cursor is in, from 0, for "Change 2 of 5": on unchanged lines, the last group before it, -1 before the first. */
export function changeAt(diff: Diff, cursor: Pick<Cursor, 'side' | 'line'>): { index: number; total: number; inside: boolean } {
  const row = diffRowOf(diff, cursor)
  const groups = changesOf(diff)
  const index = row < 0 ? -1 : groups.findLastIndex((group) => group.start <= row)
  return { index, total: groups.length, inside: index >= 0 && row <= groups[index]!.end }
}

/** In two columns, Left and Right: the cursor in the other column, on its row when that row has a line there, else on the nearest row that has, the one above first. */
export function columnMoved(rows: Rows, cursor: Cursor, column: Column): Cursor | null {
  const from = rowOfLine(rows, cursor.side, cursor.line)
  if (from < 0) return null
  for (let distance = 0; distance < rows.length; distance += 1) {
    for (const index of distance === 0 ? [from] : [from - distance, from + distance]) {
      const cell = rows[index] ? cellsOf(rows[index]).find((each) => each.column === column) : undefined
      if (cell) return cursorOn(cell.line, column)
    }
  }
  return null
}

/**
 * A cursor whose line no row draws, as one kept from a view drawn before, goes to the next line of its side that is
 * drawn, else the last before it, with nothing more selected. One that is drawn stays as it is. Null with no line.
 */
export function snapped(rows: Rows, cursor: Cursor): Cursor | null {
  if (rowOfLine(rows, cursor.side, cursor.line) >= 0) return cursor
  let before: number | null = null
  for (const item of rows) {
    for (const line of linesIn(item)) {
      const number = lineNumberOn(line, cursor.side)
      if (number == null) continue
      if (number >= cursor.line) return { ...cursor, line: number, anchor: number }
      before = number
    }
  }
  return before == null ? null : { ...cursor, line: before, anchor: before }
}

/**
 * A click on a line's number: the cursor goes to that line, or with Shift its end of the selection does, when the line
 * is on the selection's side.
 */
export function clicked(cursor: Cursor | null, line: DiffLine, column: Column, extend: boolean, split: boolean): Cursor {
  const number = cursor ? lineNumberOn(line, cursor.side) : undefined
  if (extend && cursor && number != null) return { ...cursor, line: number, column: split ? column : cursor.column }
  return cursorOn(line, split ? column : columnOf(line))
}
