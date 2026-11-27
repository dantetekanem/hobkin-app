/**
 * What a windowed transcript (`windowed-list.tsx`) keeps of each list once it is gone, by the list's name: where the
 * user left it, following its newest row or reading from a row and how far into that row, and how tall its rows were
 * drawn, at the width they were drawn at. Coming back opens the list where it was left (the user, 2026-11-26: "Where I
 * left it"), its rows at the heights they had. Kept on globalThis, so a hot update of this module keeps it too, and for
 * the lists left most recently only. Without React or a window, so it is tested as it is.
 */

/** Where a list was left: following its newest row, or read from the row `key`, `offset` pixels into it. */
export type Place = { pinned: true } | { pinned: false; key: string; offset: number }

export interface Kept {
  place: Place
  /** Each row's height by its key, as drawn at `width`. */
  sizes: ReadonlyMap<string, number>
  /** How wide the list's box was when its rows were drawn. Another width wraps their words otherwise. */
  width: number
}

/** The size of the box a list scrolls in. */
export interface Box {
  width: number
  height: number
}

/** How many lists are kept. Leaving one more lets go of the one left longest ago. */
export const KEPT_LISTS = 24

interface Store {
  lists: Map<string, Kept>
  box: Box | null
}

const store: Store = ((globalThis as { __hobkinWindowedPlaces?: Store }).__hobkinWindowedPlaces ??= { lists: new Map(), box: null })

/** What was kept of the list `name` when it was left, if it was. Asking makes it the one left most recently. */
export function keptList(name: string): Kept | undefined {
  const kept = store.lists.get(name)
  if (kept) {
    store.lists.delete(name)
    store.lists.set(name, kept)
  }
  return kept
}

export function keepList(name: string, kept: Kept): void {
  store.lists.delete(name)
  store.lists.set(name, kept)
  for (const oldest of store.lists.keys()) {
    if (store.lists.size <= KEPT_LISTS) break
    store.lists.delete(oldest)
  }
}

/** The size of the box the last list scrolled in, for the next one to open at before it has its own. */
export const keptRect = (): Box | null => store.box
export function keepRect(box: Box): void {
  store.box = { width: box.width, height: box.height }
}

/** Where a list is now: following its newest row, or read from `row`, the first row still in view at `offset`. */
export function placeAt(row: { key: string; start: number } | undefined, offset: number, pinned: boolean): Place {
  return pinned || !row ? { pinned: true } : { pinned: false, key: row.key, offset: offset - row.start }
}

/** Where a list opens: at its newest, following it, or reading from the row at `index`, `offset` pixels into it. */
export type Opening = { pinned: true } | { pinned: false; index: number; offset: number }

/** Where a list left at `place` opens, its rows found by key. A row no longer there opens it at its newest. */
export function openingOf(place: Place | undefined, indexOf: (key: string) => number): Opening {
  if (!place || place.pinned) return { pinned: true }
  const index = indexOf(place.key)
  return index < 0 ? { pinned: true } : { pinned: false, index, offset: place.offset }
}

/** About how wide a character of the transcript's 15 px text is, and how tall its line (`leading-relaxed`), in pixels. */
const CHARACTER = 7.5
const LINE = 24

/**
 * About how tall `text` stands as the transcript draws it in a column `width` pixels wide: each of its lines wrapped at
 * the column, a line's height apart, and a third of one for a blank line between paragraphs. A guess for a row not drawn
 * yet, as a long answer is, kept on the short side: a short guess draws a row too many, never a blank.
 */
export function textHeight(text: string, width: number): number {
  const columns = Math.max(24, Math.floor(width / CHARACTER))
  let lines = 0
  let blank = 0
  for (let start = 0; start <= text.length; ) {
    const newline = text.indexOf('\n', start)
    const end = newline < 0 ? text.length : newline
    if (end === start) blank += 1
    else lines += Math.ceil((end - start) / columns)
    start = end + 1
  }
  return Math.round(lines * LINE + (blank * LINE) / 3)
}

/** The switch that draws agent transcripts windowed: only the rows on screen and a few around them. */
export const WINDOWED_STEPS = 'hobkin:windowed-steps'

/** Whether the switch is on in `storage` (the window's localStorage): on unless it says 'off', and on when it cannot be read. */
export function windowedSteps(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): boolean {
  try {
    return storage?.getItem(WINDOWED_STEPS) !== 'off'
  } catch {
    return true
  }
}
