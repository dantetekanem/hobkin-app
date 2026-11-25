/**
 * The code view's own keys (spec 071, "Keys in the code view"), as pi-coder's `/diff` has them: what each does to the
 * code view's state. Pure, so every key is tested without a screen. A key it does not own (C and N, D and H, A, M, X, S,
 * T, I, O, P, /, ⌘?, Enter in the diff) is null here and left to the review.
 */
import { showMoreEverywhere, showWholeFile, type Diff, type DiffView } from '../code/diff-rows.ts'
import type { KeyPress } from '../keys.ts'
import { columnMoved, cursorIn, firstChange, lastChange, moved, paged, rowsOf, toChange, type Column, type Cursor, type Rows } from './cursor.ts'

/** Where the code view has the keyboard: the list of files, or the diff. */
export type Pane = 'files' | 'diff'

export interface CodeKeyState {
  pane: Pane
  /** The files listed, in order, and whether each is seen. */
  files: readonly { id: string; seen: boolean }[]
  /** The file shown. */
  file: string | null
  /** Its diff once its file is read, what of the diff is drawn, and the cursor, if it has moved yet. */
  diff: Diff | null
  view: DiffView | null
  cursor: Cursor | null
  split: boolean
  /** How many lines of code, and how many files, are in view at once. */
  page: number
  filesPage: number
}

/** What a key changes. A change with nothing in it is a key the code view owns that does nothing here, as Down on the last change. */
export interface CodeKeyChange {
  pane?: Pane
  /** Another file to show, with the cursor it keeps. */
  file?: string
  cursor?: Cursor
  view?: DiffView
  split?: boolean
  /** Z and R: the seen mark of this file goes on, or comes off. */
  seen?: string
  /** A short word to the reviewer. */
  say?: string
  /** How the diff follows the cursor: it keeps it in sight, or first scrolls this many lines. */
  scroll?: 'keep' | number
}

/** What a key does in the code view. Null when the key is the review's. */
export function codeKey(press: KeyPress, state: CodeKeyState): CodeKeyChange | null {
  const { key, shift, alt } = press
  const letter = key.length === 1 ? key.toLowerCase() : ''
  const plain = !shift && !alt
  const rows = state.diff && state.view ? rowsOf(state.diff, state.view, state.split) : null
  const cursor = rows ? cursorIn(rows, state.split, state.cursor) : null

  if (plain && (key === ']' || key === '[')) return around(state, key === ']' ? 1 : -1)
  if (!alt && letter === 'u') return unseen(state, shift ? -1 : 1)
  if (plain && (letter === 'z' || letter === 'r')) return state.file ? { seen: state.file } : {}
  if (plain && letter === 'v') return { split: !state.split }
  if (plain && (letter === 'e' || letter === 'f')) {
    if (!state.diff || !state.view) return {}
    return { view: letter === 'f' ? showWholeFile(state.view) : showMoreEverywhere(state.diff, state.view) }
  }
  if (plain && (letter === 'j' || letter === 'k')) {
    if (!state.diff || !cursor) return {}
    const next = toChange(state.diff, state.split, cursor, letter === 'j' ? 1 : -1)
    if (next) return { pane: 'diff', cursor: next, scroll: 'keep' }
    return { say: letter === 'j' ? 'No change below this one in the file.' : 'No change above this one in the file.' }
  }
  // Escape takes a selection of several lines back to the cursor's line. With none, it is the review's.
  if (key === 'Escape') {
    const several = plain && state.pane === 'diff' && cursor != null && cursor.anchor !== cursor.line
    return several ? { cursor: { ...cursor, anchor: cursor.line } } : null
  }
  return state.pane === 'files' ? filesKey(press, state) : diffKey(press, state, rows, cursor)
}

/** An index into a list of `count`, round from the end to the start and from the start to the end. */
const round = (index: number, count: number) => ((index % count) + count) % count

/** ] and [: the next and the previous file, round from the last to the first. */
function around(state: CodeKeyState, delta: 1 | -1): CodeKeyChange {
  const count = state.files.length
  if (count < 2) return {}
  const at = state.files.findIndex((file) => file.id === state.file)
  // A file not in the list is before its first going forward, and after its last going back.
  const from = at >= 0 ? at : delta > 0 ? -1 : count
  return { file: state.files[round(from + delta, count)]!.id }
}

/** U and Shift+U: the next and the previous file not seen, round the ends, and a word when there is none. */
function unseen(state: CodeKeyState, delta: 1 | -1): CodeKeyChange {
  const count = state.files.length
  const at = state.files.findIndex((file) => file.id === state.file)
  const from = at >= 0 ? at : delta > 0 ? -1 : count
  const others = at >= 0 ? count - 1 : count
  for (let step = 1; step <= others; step += 1) {
    const file = state.files[round(from + delta * step, count)]!
    if (!file.seen) return { file: file.id }
  }
  const onLastUnseen = at >= 0 && !state.files[at]!.seen
  return { say: onLastUnseen ? 'This is the last file not seen yet.' : 'Every file is seen.' }
}

/** The list's keys: Up and Down change the file and the diff follows, Enter or Right go to the diff. */
function filesKey({ key, shift, alt }: KeyPress, state: CodeKeyState): CodeKeyChange | null {
  if (shift || alt) return null
  const at = state.files.findIndex((file) => file.id === state.file)
  const to = (index: number): CodeKeyChange => {
    const file = state.files[Math.max(0, Math.min(state.files.length - 1, index))]
    return file && file.id !== state.file ? { file: file.id } : {}
  }
  switch (key) {
    case 'ArrowDown':
      return to(at + 1)
    case 'ArrowUp':
      return to(at - 1)
    case 'PageDown':
      return to(at + state.filesPage)
    case 'PageUp':
      return to(at - state.filesPage)
    case 'Home':
      return to(0)
    case 'End':
      return to(state.files.length - 1)
    case 'Enter':
    case 'ArrowRight':
      return { pane: 'diff', scroll: 'keep' }
    default:
      return null
  }
}

/** The keys that move the cursor in the diff. */
const CURSOR_KEYS = ['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']

/** The diff's keys: the cursor and the selection, and Left back to the list. */
function diffKey({ key, shift, alt }: KeyPress, state: CodeKeyState, rows: Rows | null, cursor: Cursor | null): CodeKeyChange | null {
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    if (shift || alt) return null
    // In two columns, Left and Right first go between the old side and the new.
    const toward: Column = key === 'ArrowLeft' ? 'old' : 'new'
    if (state.split && rows && cursor && cursor.column !== toward) {
      const next = columnMoved(rows, cursor, toward)
      return next ? { cursor: next, scroll: 'keep' } : {}
    }
    return key === 'ArrowLeft' ? { pane: 'files' } : {}
  }
  if (!CURSOR_KEYS.includes(key)) return null
  if (!state.diff || !state.view || !rows || !cursor) return {}
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const next = moved(state.diff, state.view, state.split, cursor, key === 'ArrowDown' ? 1 : -1, { lines: alt, extend: shift })
    return next ? { cursor: next.cursor, view: next.view, scroll: 'keep' } : {}
  }
  if (shift || alt) return null
  if (key === 'Home' || key === 'End') {
    const next = key === 'Home' ? firstChange(rows, state.split) : lastChange(rows, state.split)
    return next ? { cursor: next, scroll: 'keep' } : {}
  }
  const delta = key === 'PageDown' ? 1 : -1
  return { cursor: paged(rows, state.split, cursor, delta, state.page), scroll: delta * state.page }
}
