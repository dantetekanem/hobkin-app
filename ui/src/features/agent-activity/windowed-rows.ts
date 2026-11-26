/**
 * The rules of a windowed transcript (`windowed-list.tsx`): which of its rows are drawn, how tall the spacers that stand
 * for the rest are, which rows arrive with the entrance (arrive.ts), and where the keyboard walks. A long conversation
 * draws only the rows in view and a margin around them; the newest row, the row the keyboard is on and the rows the user
 * opened stay drawn wherever the view is. The rows not drawn are spacers in the list's own flow, as tall as those rows
 * were drawn or are guessed to be, so the drawn ones stand where they would and the list scrolls as it would. Without
 * React or a window, so they are tested as they are.
 */

/** Where a row sits in its list: its top and its bottom, in pixels from the list's top. */
export interface Span {
  start: number
  end: number
}

/** The first and last row in view. */
export interface InView {
  startIndex: number
  endIndex: number
}

interface Drawn {
  count: number
  visible: InView | null
  spanOf: (index: number) => Span
  /** How far above and below the view rows are drawn too, in pixels. */
  margin: number
  /** At most this many rows each way for the margin. */
  most: number
  /** Rows drawn wherever the view is. */
  keep: Iterable<number>
  /** While the list follows its newest row: the first row its end shows (`endFrom`), drawn on to the newest. */
  endFrom: number | null
}

/**
 * The rows to draw, top to bottom: those in view, those within `margin` of it (at most `most` each way), the newest,
 * every row in `keep`, and while the list follows its newest row every row its end shows, so following a row that grows
 * never scrolls onto rows not drawn yet.
 */
export function mountedIndexes({ count, visible, spanOf, margin, most, keep, endFrom }: Drawn): number[] {
  if (count === 0) return []
  const drawn = new Set<number>([count - 1])
  const drawFrom = (first: number, last: number) => {
    for (let index = first; index <= last; index++) drawn.add(index)
  }

  if (visible) {
    const top = spanOf(visible.startIndex).start
    const bottom = spanOf(visible.endIndex).end
    // Each way, rows go on being drawn while they are within the margin, and no more of them than `most`.
    const drawsAbove = (index: number) => index >= 0 && visible.startIndex - index <= most && top - spanOf(index).end < margin
    const drawsBelow = (index: number) => index < count && index - visible.endIndex <= most && spanOf(index).start - bottom < margin
    let first = visible.startIndex
    while (drawsAbove(first - 1)) first -= 1
    let last = visible.endIndex
    while (drawsBelow(last + 1)) last += 1
    drawFrom(first, last)
  }
  if (endFrom !== null) drawFrom(Math.max(0, endFrom), count - 1)
  for (const index of keep) {
    if (index >= 0 && index < count) drawn.add(index)
  }
  return [...drawn].sort((left, right) => left - right)
}

/** The first row a view `height` tall shows when it is at the end of the list. */
export function endFrom(count: number, spanOf: (index: number) => Span, height: number): number {
  if (count === 0) return 0
  const top = spanOf(count - 1).end - height
  // Rows are in order, so their bottoms are too: the first whose bottom is below the view's top.
  let low = 0
  let high = count - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (spanOf(middle).end > top) high = middle
    else low = middle + 1
  }
  return low
}

/** What the list draws, in order: a row, by its place in the list, or a spacer as tall as the rows it stands for. */
export type Piece = { kind: 'row'; index: number } | { kind: 'gap'; key: string; height: number }

/**
 * The drawn rows `indexes` with spacers for the rows between and around them. The list puts `gap` between each two of
 * its children, a spacer too, so a spacer is as tall as the rows it stands for with the gaps between them, less the gaps
 * the list adds around it.
 */
export function piecesOf(indexes: readonly number[], count: number, spanOf: (index: number) => Span, gap: number): Piece[] {
  const pieces: Piece[] = []
  let gaps = 0
  const spacer = (height: number) => pieces.push({ kind: 'gap', key: `gap:${gaps++}`, height: Math.max(0, height) })
  let before = -1
  for (const index of indexes) {
    if (before === -1 && index > 0) spacer(spanOf(index).start - spanOf(0).start - gap)
    else if (before !== -1 && index > before + 1) spacer(spanOf(index).start - spanOf(before).end - 2 * gap)
    pieces.push({ kind: 'row', index })
    before = index
  }
  if (before !== -1 && before < count - 1) spacer(spanOf(count - 1).end - spanOf(before).end - gap)
  return pieces
}

/** The rows drawn, from the pieces. */
export const rowsAt = <Row>(pieces: readonly Piece[], rows: readonly Row[]): Row[] => pieces.flatMap((piece) => (piece.kind === 'row' ? [rows[piece.index]!] : []))

/**
 * Which rows arrive with the entrance: a row whose key was not in the list when it was last drawn. The rows drawn with
 * the list are simply there; one that scrolls back into view, or that came while it was out of view, is not new. A row
 * that went and came back, as the thinking row between steps, arrives again.
 */
export class FreshKeys {
  private last: ReadonlySet<string> | null = null

  fresh(key: string): boolean {
    return this.last !== null && !this.last.has(key)
  }

  /** The keys the list has, once it is drawn with them. */
  drawn(keys: readonly string[]): void {
    this.last = new Set(keys)
  }
}

/** The next row after `from`, going `by`, that the keyboard can stand on; -1 past the end. From past an end, the first from it. */
export function nextWalkable(from: number, by: 1 | -1, count: number, walkable: (index: number) => boolean): number {
  for (let index = from + by; index >= 0 && index < count; index += by) if (walkable(index)) return index
  return -1
}

/** Whether any of the rows from `first` to `last` is in view, or within `near` rows of it. */
export function nearRows(visible: InView | null, first: number, last: number, near: number): boolean {
  return visible !== null && last >= visible.startIndex - near && first <= visible.endIndex + near
}

/**
 * The keyboard's way through a windowed list, which draws only some of its rows: a row by its place in the whole list,
 * the next one it can stand on, and moving onto a row, drawn first if it is not. `agent-keys.ts` walks with it.
 */
export interface StepWalk {
  /** The place of a drawn row in the whole list, or -1. */
  indexOf(row: Element): number
  /** As `nextWalkable`, over the whole list. */
  next(from: number, by: 1 | -1): number
  count(): number
  /** Draws the row at `index` if it is not drawn, and moves the keyboard onto it. */
  focus(index: number): void
}

const walks = new WeakMap<Element, StepWalk>()

/** The walk of a windowed list, by the list element; none for a list drawn whole. */
export const walkOf = (list: Element): StepWalk | undefined => walks.get(list)

/** Makes `walk` the way through `list` until the returned function is called. */
export function walkHere(list: Element, walk: StepWalk): () => void {
  walks.set(list, walk)
  return () => {
    if (walks.get(list) === walk) walks.delete(list)
  }
}
