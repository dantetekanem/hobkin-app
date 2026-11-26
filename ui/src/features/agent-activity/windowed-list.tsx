import { useVirtualizer, type Range, type VirtualItem, type Virtualizer } from '@tanstack/react-virtual'
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { ArriveAs } from './arrive.ts'
import { UNFOLD, type FollowStart } from './follow.ts'
import { useFollow, type Follow } from './use-follow.ts'
import { keepList, keepRect, keptList, keptRect, openingOf, placeAt, type Opening, type Place } from './windowed-place.ts'
import { endFrom, FreshKeys, mountedIndexes, nextWalkable, piecesOf, rowsAt, walkHere, type InView, type Piece, type Span } from './windowed-rows.ts'

/**
 * An agent's transcript drawn windowed, behind the switch `hobkin:windowed-steps` (windowed-place.ts): only the rows on
 * screen and a view's height of rows around them are drawn, and the rest are spacers in the list's own flow, as tall as
 * those rows were drawn or are guessed to be (the user, 2026-11-26: "Yes, Safari first"; "probably too many react/html
 * elements that should just be on by what the screen shows"). TanStack Virtual keeps the rows' heights, measured as they
 * are drawn, and the place the user reads when rows come or change above it, as WebKit anchors no scroll by itself.
 * `follow.ts` stays the only one that follows the newest row: TanStack follows nothing (`scrollEndThreshold` below no
 * distance), and holds still while the list follows. The newest row, the row the keyboard is on, the rows the user opened
 * or pressed in, and while the list follows every row its end shows, stay drawn wherever the view is (windowed-rows.ts).
 * A row arrives only the first time its key is in the list, never when it scrolls back into view. Each list, by its
 * name, keeps where it was left and its rows' heights for when it is drawn again (the user: "Where I left it").
 */

/** How far above and below the view rows are drawn too, in views: a fast scroll lands on rows already drawn. */
const MARGIN_VIEWS = 1
/** At most this many rows each way for that margin. */
const MOST_EACH_WAY = 12

export interface WindowedOptions<Row> {
  /** Whose rows these are: where the list was left and how tall its rows were are kept by it. */
  name: string
  rows: readonly Row[]
  /** A row's key: the same for as long as the row shows, in every state. */
  keyOf: (row: Row) => string
  /** How tall a row not drawn yet is guessed to be. A short guess draws a row too many, never a blank. */
  estimate: (row: Row) => number
  /** The rows the keyboard walks onto. Every row without it. */
  walkable?: (row: Row) => boolean
  /** The list's own spacing, as its classes set it: the gap between rows and its padding above and below them. */
  spacing: { gap: number; top: number; bottom: number }
}

export interface WindowedList<Row> {
  /** The scroller and list refs, the way back down and following, as `useFollow` gives them. */
  scroll: Follow
  /** What to draw, in order: rows by their place in `rows`, and spacers. */
  pieces: readonly Piece[]
  rows: readonly Row[]
  keyAt: (index: number) => string
  /** The rows drawn now. */
  shown: readonly Row[]
  /** The first and last row in view, before the margin. Null before the list has a size. */
  inView: InView | null
  /** Whether a row drawn now with this key arrives (`FreshKeys`). */
  fresh: (key: string) => boolean
}

type Rows = Virtualizer<HTMLDivElement, HTMLElement>
const NONE: readonly VirtualItem[] = []
const NO_KEYS: ReadonlySet<string> = new Set()

/**
 * Where a list shown again starts: at the row it was left reading, as far into it as it was, wherever its rows' heights
 * have put that row since, or at its newest. TanStack takes the same place, as it writes its own when it takes the
 * scroller again.
 */
function shownAgain(rows: Rows | null, place: Place | undefined, indexes: ReadonlyMap<string, number>): FollowStart {
  const index = place && !place.pinned ? indexes.get(place.key) : undefined
  const row = index === undefined ? undefined : rows?.measurementsCache[index]
  if (!rows || !row || !place || place.pinned) return { following: true, top: 0 }
  const top = row.start + place.offset
  rows.scrollOffset = top
  return { following: false, top }
}

/** What a list starts from: where it opens, and the row heights kept from the last time it was drawn, at its width. */
function startOf(name: string, indexOf: (key: string) => number): { opening: Opening; seeded: VirtualItem[] } {
  const kept = keptList(name)
  const box = keptRect()
  const opening = openingOf(kept?.place, indexOf)
  const seeded = kept && box && kept.width === box.width ? [...kept.sizes].map(([key, size]) => ({ key, size, index: 0, start: 0, end: size, lane: 0 })) : []
  return { opening, seeded }
}

export function useWindowedList<Row>({ name, rows, keyOf, estimate, walkable, spacing }: WindowedOptions<Row>): WindowedList<Row> {
  const keys = useMemo(() => rows.map(keyOf), [rows, keyOf])
  const indexes = useMemo(() => new Map(keys.map((key, index) => [key, index])), [keys])
  const [{ opening, seeded }] = useState(() => startOf(name, (key) => indexes.get(key) ?? -1))
  const self = useRef<Rows | null>(null)
  // Where follow.ts starts: where the list opens, its top worked out below as the rows are first laid out, and each time
  // it is shown again, as a kept page is, at the row it was left reading, wherever that row is now (`shownAgain`).
  const openTop = useRef(0)
  const shows = useRef(0)
  const indexesNow = useRef(indexes)
  indexesNow.current = indexes
  const scroll = useFollow({
    start: () => (shows.current++ === 0 ? { following: opening.pinned, top: openTop.current } : shownAgain(self.current, keptList(name)?.place, indexesNow.current)),
  })
  const following = useRef(scroll.pinned)
  following.current = scroll.pinned

  // The rows kept drawn wherever the view is: those the user opened or pressed in, the one the keyboard is on, and the
  // one it was just walked onto.
  const [opened, setOpened] = useState(NO_KEYS)
  const [focused, setFocused] = useState<string | null>(null)
  const [walkedTo, setWalkedTo] = useState<string | null>(null)
  const lastWalkable = useMemo(() => {
    for (let index = rows.length - 1; index >= 0; index--) if (!walkable || walkable(rows[index]!)) return index
    return -1
  }, [rows, walkable])

  // A row's height as measured, and the width it was measured at: one measured at another width, or kept from the
  // last time the list was drawn, is not known yet, so its first measure keeps the view as a new row's does.
  const measuredAt = useRef(new Map<string, number>())
  const lastMeasure = useRef<{ key: string; known: boolean } | null>(null)
  const measureElement = useCallback((element: HTMLElement, entry: ResizeObserverEntry | undefined, rows: Rows) => {
    const key = String(rows.options.getItemKey(rows.indexFromElement(element)))
    const width = rows.scrollRect?.width ?? 0
    const known = measuredAt.current.get(key) === width
    const box = entry?.borderBoxSize?.[0]
    const held = rows.itemSizeCache.get(key)
    if (!box && known && held !== undefined) return held
    lastMeasure.current = { key, known }
    measuredAt.current.set(key, width)
    return box ? Math.round(box.blockSize) : element.offsetHeight
  }, [])
  // A row that changed height above the view moves the view by as much, so what the user reads stays: a row measured
  // for the first time if it starts above the view, one measured before only if it is all above it and the user is not
  // scrolling up. Never while the list follows its newest row: follow.ts takes it to the end.
  const keepsView = useCallback((item: VirtualItem, _delta: number, rows: Rows) => {
    if (following.current) return false
    const top = rows.scrollOffset ?? 0
    const first = !(lastMeasure.current?.key === item.key && lastMeasure.current.known)
    return first ? item.start < top : item.end <= top && rows.scrollDirection !== 'backward'
  }, [])

  const rangeExtractor = useCallback(
    (range: Range) => {
      const list = self.current
      const spanOf = (index: number): Span => list!.measurementsCache[index]!
      const height = list?.scrollRect?.height ?? 0
      const keep = [lastWalkable]
      for (const key of [...opened, focused, walkedTo]) {
        const index = key === null ? undefined : indexes.get(key)
        if (index !== undefined) keep.push(index)
      }
      return mountedIndexes({
        count: range.count,
        visible: { startIndex: range.startIndex, endIndex: range.endIndex },
        spanOf,
        margin: height * MARGIN_VIEWS,
        most: MOST_EACH_WAY,
        keep,
        // The view's own range is the end too once TanStack has read the scroll follow.ts wrote: until then, a view of it.
        endFrom: scroll.pinned && list ? endFrom(range.count, spanOf, height) : null,
      })
    },
    [indexes, lastWalkable, opened, focused, walkedTo, scroll.pinned],
  )
  const getItemKey = useCallback((index: number) => keys[index]!, [keys])
  const box = keptRect()
  const first = useRef(true)

  const list = useVirtualizer<HTMLDivElement, HTMLElement>({
    count: keys.length,
    getScrollElement: () => scroll.scroller.current,
    estimateSize: (index) => estimate(rows[index]!),
    getItemKey,
    gap: spacing.gap,
    paddingStart: spacing.top,
    paddingEnd: spacing.bottom,
    // The margin is in pixels, from the view's height (rangeExtractor).
    overscan: 0,
    // TanStack keeps the row the user reads in place when rows come or go above it. It never follows the end itself.
    anchorTo: 'end',
    scrollEndThreshold: -1,
    initialRect: box ?? { width: 0, height: globalThis.innerHeight ?? 800 },
    // Where it opens, worked out from the rows' kept or guessed heights the first time the list asks.
    initialOffset: () => {
      const rows = self.current!
      const height = rows.scrollRect?.height ?? box?.height ?? globalThis.innerHeight ?? 800
      const row = opening.pinned ? undefined : rows.measurementsCache[opening.index]
      const top = row && !opening.pinned ? row.start + opening.offset : Math.max(0, rows.getTotalSize() - height)
      openTop.current = top
      return top
    },
    // The heights kept from the last time, given only once: TanStack takes them again whenever it has no rows.
    initialMeasurementsCache: first.current ? seeded : [],
    rangeExtractor,
    measureElement,
  })
  self.current = list
  list.shouldAdjustScrollPositionOnItemSizeChange = keepsView
  first.current = false
  // A list drawn before it had rows, as a page waiting for its conversation, opens at its newest once they come, as it
  // would have with them: TanStack works out its opening place again rather than read them from the top.
  const hadRows = useRef(keys.length > 0)
  if (!hadRows.current && keys.length > 0) {
    hadRows.current = true
    list.scrollOffset = null
  }

  // The rows to draw. While the list has no size (hidden, as a kept page is), the rows it drew last stay.
  const drawnKeys = useRef<readonly string[]>([])
  const items = list.getVirtualItems()
  const drawn = items.length || !keys.length ? items : NONE
  const pieces = useMemo(() => {
    const at = new Map(drawn.map((item) => [item.index, item]))
    const spanOf = (index: number): Span => at.get(index) ?? list.measurementsCache[index]!
    const indexesDrawn = drawn.length
      ? drawn.map((item) => item.index)
      : mountedIndexes({ count: keys.length, visible: null, spanOf, margin: 0, most: 0, keep: drawnKeys.current.flatMap((key) => indexes.get(key) ?? []), endFrom: null })
    return piecesOf(indexesDrawn, keys.length, spanOf, spacing.gap)
  }, [drawn, keys.length, indexes, list, spacing.gap])
  const shown = useMemo(() => rowsAt(pieces, rows), [pieces, rows])
  const keyAt = useCallback((index: number) => keys[index]!, [keys])

  // Arrivals go by key: what the list was last drawn with is not new.
  const [arrivals] = useState(() => new FreshKeys())
  const fresh = useCallback((key: string) => arrivals.fresh(key), [arrivals])
  useLayoutEffect(() => arrivals.drawn(keys), [arrivals, keys])

  // Each drawn row is told its place in the list and measured: TanStack watches it for changes in height from then on.
  useLayoutEffect(() => {
    drawnKeys.current = shown.map(keyOf)
    const element = scroll.content.current
    if (!element) return
    const children = element.children
    let at = 0
    for (const piece of pieces) {
      const child = children[at++] as HTMLElement | undefined
      // The list is not as drawn: nothing is measured rather than a row as another.
      if (!child || (piece.kind === 'gap') !== child.hasAttribute('data-gap')) return
      if (piece.kind === 'gap') continue
      const index = String(piece.index)
      if (child.getAttribute('data-index') !== index) child.setAttribute('data-index', index)
      list.measureElement(child)
    }
    // Rows no longer drawn are let go.
    list.measureElement(null)
  })

  // The rows the user opens or presses in, and the one the keyboard is on, stay drawn, so they keep what they show.
  const keysNow = useRef(keys)
  keysNow.current = keys
  useLayoutEffect(() => {
    const element = scroll.content.current
    if (!element) return
    const keyIn = (target: EventTarget | null) => {
      let row = target instanceof Element ? target : null
      while (row && row.parentElement !== element) row = row.parentElement
      const index = row?.getAttribute('data-index')
      return index ? (keysNow.current[Number(index)] ?? null) : null
    }
    const open = (event: Event) => {
      const key = keyIn(event.target)
      if (key) setOpened((now) => (now.has(key) ? now : new Set(now).add(key)))
    }
    const focusIn = (event: FocusEvent) => setFocused(keyIn(event.target))
    const focusOut = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node && element.contains(event.relatedTarget))) setFocused(null)
    }
    element.addEventListener('click', open)
    element.addEventListener(UNFOLD, open)
    element.addEventListener('focusin', focusIn)
    element.addEventListener('focusout', focusOut)
    return () => {
      element.removeEventListener('click', open)
      element.removeEventListener(UNFOLD, open)
      element.removeEventListener('focusin', focusIn)
      element.removeEventListener('focusout', focusOut)
    }
  }, [scroll.content])

  // The keyboard walks the whole list: a row not drawn is drawn first, then it takes the keyboard and comes into view.
  const walkableNow = useRef(walkable)
  walkableNow.current = walkable
  const rowsNow = useRef(rows)
  rowsNow.current = rows
  useLayoutEffect(() => {
    const element = scroll.content.current
    if (!element) return
    return walkHere(element, {
      indexOf: (row) => (row.parentElement === element && row.hasAttribute('data-index') ? Number(row.getAttribute('data-index')) : -1),
      next: (from, by) => nextWalkable(from, by, rowsNow.current.length, (index) => walkableNow.current?.(rowsNow.current[index]!) ?? true),
      count: () => rowsNow.current.length,
      focus: (index) => {
        const key = keysNow.current[index]
        if (key === undefined) return
        let row = self.current?.elementsCache.get(key)
        if (!row?.isConnected) {
          flushSync(() => setWalkedTo(key))
          row = self.current?.elementsCache.get(key)
        }
        row?.focus()
      },
    })
  }, [scroll.content])

  // Where the list was left and how tall its rows were, kept for the next time it is drawn, or shown again.
  useLayoutEffect(
    () => () => {
      const rows = self.current
      if (!rows) return
      const top = rows.scrollOffset ?? 0
      const row = rows.getVirtualItemForOffset(top)
      const place = placeAt(row ? { key: String(row.key), start: row.start } : undefined, top, following.current)
      const width = rows.scrollRect?.width ?? 0
      const sizes = new Map<string, number>()
      for (const [key, at] of measuredAt.current) {
        const size = rows.itemSizeCache.get(key)
        if (at === width && size !== undefined) sizes.set(key, size)
      }
      keepList(name, { place, sizes, width })
      if (rows.scrollRect && rows.scrollRect.height > 0) keepRect(rows.scrollRect)
    },
    [name],
  )

  return { scroll, pieces, rows, keyAt, shown, inView: list.range, fresh }
}

/**
 * The drawn rows of a windowed list, each drawn by `draw`, and the spacers between them. Every row element `draw` gives
 * must be one `li` of the list. A row draws again only when it, or `draw`, changes, not when the view moves.
 */
export function WindowedRows<Row>({ list, draw }: { list: WindowedList<Row>; draw: (row: Row) => ReactNode }) {
  return list.pieces.map((piece) => {
    if (piece.kind === 'gap') return <li key={piece.key} aria-hidden="true" data-gap="" style={{ height: piece.height }} />
    const key = list.keyAt(piece.index)
    return <Slot key={key} rowKey={key} row={list.rows[piece.index]} draw={draw as (row: unknown) => ReactNode} fresh={list.fresh} />
  })
}

const Slot = memo(function Slot({ rowKey, row, draw, fresh }: { rowKey: string; row: unknown; draw: (row: unknown) => ReactNode; fresh: (key: string) => boolean }) {
  // Whether it arrives is decided once, as it is first drawn: drawn again as it scrolls back into view, it does not.
  const [arrives] = useState(() => fresh(rowKey))
  return <ArriveAs arrives={arrives}>{draw(row)}</ArriveAs>
})
