/**
 * A file's change as rows to draw, the way GitHub shows a diff: old and new line numbers, a marker for
 * added or removed, the words that changed inside a line, three unchanged lines around each group of
 * changes, and the rest of the file within reach.
 *
 * Nothing here knows about a review, a graph or the screen. It takes a file's two sides, or a patch,
 * and can be used wherever a diff is shown.
 */
import { diffWordsWithSpace, parsePatch } from 'diff'
import { alignRows, type AlignedRow } from '#shared/review/diff.ts'

/** Unchanged lines shown on each side of a group of changes. */
export const CONTEXT_LINES = 3
/** Lines one press of "Show more" reveals. */
export const EXPAND_BY = 20
/** Past this many characters a pair of lines is not searched for changed words. */
const WORD_DIFF_LIMIT = 1200
/** A pair of lines that changed by more than this share is a rewrite, and gets no word marks. */
const REWRITE_SHARE = 0.65

export type LineKind = 'context' | 'added' | 'removed'

/** A run of characters inside a line, by UTF-16 offset. */
export interface WordRange {
  start: number
  end: number
}

export interface DiffLine {
  kind: LineKind
  marker: ' ' | '+' | '-'
  oldLine?: number
  newLine?: number
  text: string
  /** The words that changed inside this line, when it replaced or was replaced by a similar line. */
  words: WordRange[]
  /** True for a line the view was asked to point at. */
  emphasis: boolean
}

interface Row extends AlignedRow {
  oldWords: WordRange[]
  newWords: WordRange[]
  /** Lines of the file not known before this row, when the diff was read from a patch. */
  holeBefore: number
}

export interface Diff {
  rows: Row[]
  /** Runs of changed rows, as first and last row index. */
  groups: { start: number; end: number }[]
  additions: number
  deletions: number
  /** True when read from a patch: the lines between its hunks are not known, so its gaps cannot be opened. */
  partial: boolean
}

/** Lines to point at: the lines of the story's current step, or of whatever asked for this diff. */
export interface Emphasis {
  /** `added` reads new line numbers, `deleted` old ones. */
  side: 'added' | 'deleted'
  startLine: number
  endLine: number
}

/** What of a diff is on screen. A new view shows the changes with their context. The reviewer opens it up from there. */
export interface DiffView {
  whole: boolean
  emphasis: readonly Emphasis[]
  /** Lines revealed in each gap, counted from its top (`below` the part before it) and from its bottom (`above` the part after). */
  more: Readonly<Record<string, { below: number; above: number }>>
}

export type DiffItem =
  | { type: 'line'; key: string; line: DiffLine }
  /** Lines held back. `above` and `below` say which "Show more" it offers. */
  | { type: 'gap'; key: string; id: string; hidden: number; above: boolean; below: boolean }

export type SplitItem = { type: 'row'; key: string; left?: DiffLine; right?: DiffLine } | Extract<DiffItem, { type: 'gap' }>

function wordRanges(oldText: string, newText: string): { oldWords: WordRange[]; newWords: WordRange[] } {
  const none = { oldWords: [], newWords: [] }
  if (oldText === newText || oldText.length + newText.length > WORD_DIFF_LIMIT) return none
  const oldWords: WordRange[] = []
  const newWords: WordRange[] = []
  let [oldAt, newAt, oldChanged, newChanged] = [0, 0, 0, 0]
  const push = (ranges: WordRange[], start: number, end: number) => {
    const last = ranges.at(-1)
    if (last && last.end === start) last.end = end
    else ranges.push({ start, end })
  }
  for (const part of diffWordsWithSpace(oldText, newText)) {
    const length = part.value.length
    if (part.removed) {
      push(oldWords, oldAt, oldAt + length)
      oldAt += length
      oldChanged += length
    } else if (part.added) {
      push(newWords, newAt, newAt + length)
      newAt += length
      newChanged += length
    } else {
      oldAt += length
      newAt += length
    }
  }
  // Marking nearly every word says less than the line's own tint does.
  if (oldChanged > oldText.length * REWRITE_SHARE || newChanged > newText.length * REWRITE_SHARE) return none
  return { oldWords, newWords }
}

function finish(aligned: readonly (AlignedRow & { holeBefore?: number })[], partial: boolean): Diff {
  const rows: Row[] = aligned.map((row) => ({ ...row, holeBefore: row.holeBefore ?? 0, ...(row.kind === 'replace' ? wordRanges(row.oldText, row.newText) : { oldWords: [], newWords: [] }) }))
  const groups: Diff['groups'] = []
  let additions = 0
  let deletions = 0
  rows.forEach((row, index) => {
    if (row.kind === 'equal') return
    if (row.kind !== 'delete') additions += 1
    if (row.kind !== 'insert') deletions += 1
    const last = groups.at(-1)
    // A hole between two changed rows of a patch keeps them in separate groups.
    if (last && last.end === index - 1 && row.holeBefore === 0) last.end = index
    else groups.push({ start: index, end: index })
  })
  return { rows, groups, additions, deletions, partial }
}

/** The diff of a file's two sides. Null is a side where the file does not exist. */
export function diffOf(base: string | null, head: string | null): Diff {
  return finish(alignRows(base ?? '', head ?? ''), false)
}

/** The diff a patch describes, for when the two sides are not at hand. Only the first file of the patch is read. */
export function diffFromPatch(patch: string): Diff {
  const rows: (AlignedRow & { holeBefore: number })[] = []
  let knownOld = 0
  for (const hunk of parsePatch(patch)[0]?.hunks ?? []) {
    let [oldLine, newLine] = [hunk.oldStart, hunk.newStart]
    let hole = Math.max(0, hunk.oldStart - knownOld - 1)
    let removed: string[] = []
    let added: string[] = []
    const flush = () => {
      // As in a diff of two sides: a removed line pairs with the added line that took its place.
      for (let index = 0; index < Math.max(removed.length, added.length); index += 1) {
        const [oldText, newText] = [removed[index], added[index]]
        if (oldText != null && newText != null) rows.push({ kind: 'replace', oldLine: oldLine++, newLine: newLine++, oldText, newText, holeBefore: hole })
        else if (oldText != null) rows.push({ kind: 'delete', oldLine: oldLine++, oldText, newText: '', holeBefore: hole })
        else rows.push({ kind: 'insert', newLine: newLine++, oldText: '', newText: newText!, holeBefore: hole })
        hole = 0
      }
      removed = []
      added = []
    }
    for (const line of hunk.lines) {
      const text = line.slice(1)
      if (line.startsWith('-')) removed.push(text)
      else if (line.startsWith('+')) added.push(text)
      else if (line.startsWith(' ')) {
        flush()
        rows.push({ kind: 'equal', oldLine: oldLine++, newLine: newLine++, oldText: text, newText: text, holeBefore: hole })
        hole = 0
      }
    }
    flush()
    knownOld = oldLine - 1
  }
  return finish(rows, true)
}

const covers = (emphasis: readonly Emphasis[], side: Emphasis['side'], line: number | undefined) =>
  line != null && emphasis.some((range) => range.side === side && range.startLine <= line && line <= range.endLine)

/** A new view of a diff: its changes with their context, and the lines it is asked to point at. */
export function startView(_diff: Diff, emphasis: readonly Emphasis[] = []): DiffView {
  return { whole: false, emphasis, more: {} }
}

/** "Show more": twenty more lines of a gap, below the part before it or above the part after it. */
export function expandGap(view: DiffView, gapId: string, direction: 'above' | 'below'): DiffView {
  const now = view.more[gapId] ?? { below: 0, above: 0 }
  return { ...view, more: { ...view.more, [gapId]: { ...now, [direction]: now[direction] + EXPAND_BY } } }
}

/** "Whole file": every line. */
export function showWholeFile(view: DiffView): DiffView {
  return { ...view, whole: true }
}

type Shown = { range: [number, number] } | Extract<DiffItem, { type: 'gap' }>

interface Block {
  start: number
  end: number
}

/**
 * The runs of rows a view shows around what it must show, in order, before anything is opened between them: the groups
 * of changes (with a node's lines pointed at, only those touching them) and lines pointed at that hold no change
 * (context, an unchanged test), each with its context. Null when the view shows every row.
 */
function blocksOf(diff: Diff, view: DiffView): Block[] | null {
  const last = diff.rows.length - 1
  const pointedRow = (row: Row) => (row.kind !== 'delete' && covers(view.emphasis, 'added', row.newLine)) || (row.kind !== 'insert' && covers(view.emphasis, 'deleted', row.oldLine))
  const touching = view.emphasis.length === 0 ? [] : diff.groups.filter((group) => diff.rows.slice(group.start, group.end + 1).some(pointedRow))
  const seeds = (view.emphasis.length === 0 ? diff.groups : touching).map((group) => ({ ...group }))
  let run: Block | null = null
  diff.rows.forEach((row, index) => {
    const pointed = row.kind === 'equal' && pointedRow(row)
    if (pointed && run && run.end === index - 1) run.end = index
    else if (pointed) seeds.push((run = { start: index, end: index }))
  })
  // Pointing at lines that are nowhere in the diff leaves every change showing.
  if (view.emphasis.length > 0 && seeds.length === 0) seeds.push(...diff.groups.map((group) => ({ ...group })))
  if (view.whole || seeds.length === 0) return null

  const blocks: Block[] = []
  for (const seed of seeds.sort((a, b) => a.start - b.start)) {
    const block = { start: Math.max(0, seed.start - CONTEXT_LINES), end: Math.min(last, seed.end + CONTEXT_LINES) }
    const before = blocks.at(-1)
    if (before && block.start <= before.end + 1) before.end = Math.max(before.end, block.end)
    else blocks.push(block)
  }
  return blocks
}

/** Rows held back between two blocks, or before the first or after the last: how many were opened from its top and from its bottom. */
interface Gap {
  id: string
  from: number
  to: number
  below: number
  above: number
  canBelow: boolean
  canAbove: boolean
}

/** The gap before each block and the one after the last, in order. Null where the blocks leave no row between them. */
function gapsOf(diff: Diff, view: DiffView, blocks: readonly Block[]): (Gap | null)[] {
  const last = diff.rows.length - 1
  return Array.from({ length: blocks.length + 1 }, (_, index) => {
    const from = index === 0 ? 0 : blocks[index - 1]!.end + 1
    const to = index === blocks.length ? last : blocks[index]!.start - 1
    const size = to - from + 1
    if (size <= 0) return null
    const id = `gap${index}`
    const [canBelow, canAbove] = [index > 0, index < blocks.length]
    const below = canBelow ? Math.min(size, view.more[id]?.below ?? 0) : 0
    const above = canAbove ? Math.min(size - below, view.more[id]?.above ?? 0) : 0
    return { id, from, to, below, above, canBelow, canAbove }
  })
}

/** Which rows are on screen, in order, with a gap wherever rows are held back. */
function shown(diff: Diff, view: DiffView): Shown[] {
  const last = diff.rows.length - 1
  if (last < 0) return []

  // A patch shows all it has. Its gaps are the lines it does not hold.
  if (diff.partial) {
    const parts: Shown[] = []
    let start = 0
    diff.rows.forEach((row, index) => {
      if (row.holeBefore === 0) return
      if (index > start) parts.push({ range: [start, index - 1] })
      parts.push({ type: 'gap', key: `hole${index}`, id: `hole${index}`, hidden: row.holeBefore, above: false, below: false })
      start = index
    })
    parts.push({ range: [start, last] })
    return parts
  }

  const blocks = blocksOf(diff, view)
  if (!blocks) return [{ range: [0, last] }]

  const parts: Shown[] = []
  gapsOf(diff, view, blocks).forEach((gap, index) => {
    if (gap) {
      const { id, from, to, below, above } = gap
      const size = to - from + 1
      if (below + above >= size) parts.push({ range: [from, to] })
      else {
        if (below > 0) parts.push({ range: [from, from + below - 1] })
        parts.push({ type: 'gap', key: id, id, hidden: size - below - above, above: gap.canAbove, below: gap.canBelow })
        if (above > 0) parts.push({ range: [to - above + 1, to] })
      }
    }
    if (index < blocks.length) parts.push({ range: [blocks[index]!.start, blocks[index]!.end] })
  })
  return parts
}

/**
 * The view with lines `startLine` to `endLine` of one side on screen: each gap they are in opens from its nearer end,
 * just far enough, as the code view does for the unchanged lines its cursor comes to and the lines it is asked to show.
 * The same view when they show already, and for a patch, whose gaps cannot be opened.
 */
export function revealLines(diff: Diff, view: DiffView, side: Emphasis['side'], startLine: number, endLine: number): DiffView {
  if (diff.partial) return view
  const blocks = blocksOf(diff, view)
  if (!blocks) return view
  let [first, last] = [-1, -1]
  diff.rows.forEach((row, index) => {
    const line = side === 'added' ? (row.kind === 'delete' ? undefined : row.newLine) : row.kind === 'insert' ? undefined : row.oldLine
    if (line == null || line < startLine || line > endLine) return
    if (first < 0) first = index
    last = index
  })
  if (first < 0) return view

  let more = view.more
  for (const gap of gapsOf(diff, view, blocks)) {
    if (!gap) continue
    // What is still held back in it, and of that, what is wanted.
    const [top, bottom] = [gap.from + gap.below, gap.to - gap.above]
    const [from, to] = [Math.max(first, top), Math.min(last, bottom)]
    if (from > to) continue
    const fromTop = to - top + 1
    const fromBottom = bottom - from + 1
    const opensFromTop = gap.canBelow && (!gap.canAbove || fromTop <= fromBottom)
    more = { ...more, [gap.id]: opensFromTop ? { below: gap.below + fromTop, above: gap.above } : { below: gap.below, above: gap.above + fromBottom } }
  }
  return more === view.more ? view : { ...view, more }
}

/** The number a line has on one side of the file: a removed line is on the old side only, an added one on the new side only, and an unchanged one on both. */
export function lineNumberOn(line: DiffLine, side: Emphasis['side']): number | undefined {
  if (side === 'added') return line.kind === 'removed' ? undefined : line.newLine
  return line.kind === 'added' ? undefined : line.oldLine
}

/** The lines a row draws: one in one column, up to two side by side in two, none in a gap. */
export function linesIn(item: DiffItem | SplitItem): DiffLine[] {
  if (item.type === 'line') return [item.line]
  if (item.type === 'row') return [item.left, item.right].filter((line): line is DiffLine => line != null)
  return []
}

/** The row that draws a line of one side, in one column or two. -1 when no row on screen does. */
export function rowOfLine(items: readonly (DiffItem | SplitItem)[], side: Emphasis['side'], line: number): number {
  return items.findIndex((item) => linesIn(item).some((each) => lineNumberOn(each, side) === line))
}

function lineOf(row: Row, side: 'old' | 'new', view: DiffView): DiffLine {
  if (row.kind === 'equal') {
    return { kind: 'context', marker: ' ', oldLine: row.oldLine, newLine: row.newLine, text: row.newText, words: [], emphasis: covers(view.emphasis, 'added', row.newLine) || covers(view.emphasis, 'deleted', row.oldLine) }
  }
  if (side === 'old') return { kind: 'removed', marker: '-', oldLine: row.oldLine, text: row.oldText, words: row.oldWords, emphasis: covers(view.emphasis, 'deleted', row.oldLine) }
  return { kind: 'added', marker: '+', newLine: row.newLine, text: row.newText, words: row.newWords, emphasis: covers(view.emphasis, 'added', row.newLine) }
}

/** One column: within a group of changes, what was removed comes first and what was added after. */
export function unifiedRows(diff: Diff, view: DiffView): DiffItem[] {
  const items: DiffItem[] = []
  for (const part of shown(diff, view)) {
    if ('type' in part) {
      items.push(part)
      continue
    }
    let added: DiffItem[] = []
    for (let index = part.range[0]; index <= part.range[1]; index += 1) {
      const row = diff.rows[index]!
      if (row.kind === 'equal') {
        items.push(...added, { type: 'line', key: `c${index}`, line: lineOf(row, 'new', view) })
        added = []
        continue
      }
      if (row.kind !== 'insert') items.push({ type: 'line', key: `r${index}`, line: lineOf(row, 'old', view) })
      if (row.kind !== 'delete') added.push({ type: 'line', key: `a${index}`, line: lineOf(row, 'new', view) })
    }
    items.push(...added)
  }
  return items
}

/** Two columns: the old side on the left and the new side on the right, row by row. */
export function splitRows(diff: Diff, view: DiffView): SplitItem[] {
  const items: SplitItem[] = []
  for (const part of shown(diff, view)) {
    if ('type' in part) {
      items.push(part)
      continue
    }
    for (let index = part.range[0]; index <= part.range[1]; index += 1) {
      const row = diff.rows[index]!
      items.push({
        type: 'row',
        key: `s${index}`,
        ...(row.kind !== 'insert' ? { left: lineOf(row, 'old', view) } : {}),
        ...(row.kind !== 'delete' ? { right: lineOf(row, 'new', view) } : {}),
      })
    }
  }
  return items
}

/**
 * The item a view opens at, for lines it points at: the first changed line from where those lines begin on
 * the new side. With no change there, the first change among them (a node only removed), else the first of
 * its lines. -1 when nothing is pointed at.
 */
export function openingIndex(items: readonly (DiffItem | SplitItem)[], emphasis: readonly Emphasis[]): number {
  const linesOf = (item: DiffItem | SplitItem): DiffLine[] => (item.type === 'line' ? [item.line] : item.type === 'row' ? [item.right, item.left].filter((line) => line != null) : [])
  const find = (test: (line: DiffLine) => boolean, from = 0) => items.findIndex((item, index) => index >= from && linesOf(item).some(test))
  const changed = (line: DiffLine) => line.emphasis && line.kind !== 'context'
  const start = Math.min(...emphasis.filter((range) => range.side === 'added').map((range) => range.startLine))
  const anchor = Number.isFinite(start) ? find((line) => line.newLine != null && line.newLine >= start) : -1
  const own = anchor >= 0 ? find((line) => line.emphasis && line.kind === 'added', anchor) : -1
  if (own >= 0) return own
  const first = find(changed)
  return first >= 0 ? first : find((line) => line.emphasis)
}

export interface FileSides {
  path: string
  /** The path at base, when the file was renamed. */
  oldPath?: string
  base: string | null
  head: string | null
  binary: boolean
}

export interface FileDescription {
  kind: 'added' | 'deleted' | 'renamed' | 'modified' | 'unchanged' | 'binary'
  /** The path, or both paths of a renamed file. */
  title: string
  /** Said in place of lines when there are none to show. */
  note: string | null
}

/** What kind of change a file went through, and what to say when it has no lines to show. */
export function describeFile(file: FileSides): FileDescription {
  const renamed = file.oldPath != null && file.oldPath !== file.path
  const title = renamed ? `${file.oldPath} → ${file.path}` : file.path
  if (file.binary) return { kind: 'binary', title, note: 'A binary file. Its contents are not shown.' }
  const same = file.base === file.head
  if (renamed) return { kind: 'renamed', title, note: same ? 'Renamed. Its contents did not change.' : null }
  if (file.base == null) return { kind: 'added', title, note: file.head ? null : 'An empty file.' }
  if (file.head == null) return { kind: 'deleted', title, note: file.base ? null : 'An empty file.' }
  return { kind: same ? 'unchanged' : 'modified', title, note: null }
}
