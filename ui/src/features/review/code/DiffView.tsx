import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual'
import { ChevronDown, ChevronUp, UnfoldVertical } from 'lucide-react'
import { memo, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import './code.css'
import {
  describeFile,
  diffFromPatch,
  diffOf,
  expandGap,
  lineNumberOn,
  rowOfLine,
  showMoreEverywhere,
  showWholeFile,
  splitRows,
  stableScroll,
  startView,
  unifiedRows,
  type Diff,
  type DiffItem,
  type DiffLine,
  type DiffView as ShownView,
  openingIndex,
  type Emphasis,
  type FileSides,
  type SplitItem,
} from './diff-rows.ts'
import { languageOf } from './languages.ts'
import { FONT, tokenStyle, type Highlighted } from './tokens.ts'
import { segmentsOf } from './segments.ts'
import { useHighlighted, type HighlightedText } from './use-highlighted.ts'

/** Rows are measured once drawn. Until then each is taken to be one line of code tall: 13px at a line height of 1.7. */
const LINE_HEIGHT = 22.1
/** A row drawn under a line, such as the input of a note, until it is measured. */
const INSERTED_HEIGHT = 76

/** A line of one side, as the code view's cursor and its notes name it. */
export interface LinePlace {
  side: Emphasis['side']
  line: number
}

export interface DiffViewHandle {
  /** Reveals twenty more lines around every group. For a key, where a button cannot be pointed at. */
  showMore(): void
  showWholeFile(): void
  scrollBy(lines: number): void
  /** Grows or shrinks the selection by one line, starting one when there is none. For Shift with Up and Down. */
  moveSelection(delta: 1 | -1): void
  /** Scrolls the least that keeps a line's row, or the row drawn under `insert`, in sight: nothing while it is in view, else it comes to the middle (`stableScroll`). */
  keepInView(at: LinePlace | 'insert'): void
  /** How many lines of code the view shows at once, less one, for Page Up and Page Down. */
  pageLines(): number
}

/** Lines of one side with a count, such as how many notes they carry. */
export interface LineMark extends Emphasis {
  count: number
}

/** Lines of one side with the notes that start on them, drawn as a square for a comment and a diamond for a question. */
export interface LineGlyph extends Emphasis {
  comments: number
  questions: number
}

/** The code view's cursor: a bar across its line, in two columns on its column only. `quiet` while the keyboard is elsewhere. */
export interface LineCursor extends LinePlace {
  column: 'old' | 'new'
  quiet?: boolean
}

export interface DiffViewProps {
  /** The file's two sides. A side is null where the file does not exist. */
  file: FileSides
  /** A patch to draw instead, when the two sides are not at hand. The gaps between its hunks cannot be opened. */
  patch?: string
  /** The diff, when the caller has worked it out already, as the code view does to walk its lines. Else it is worked out here. */
  diff?: Diff
  /** Lines to point at: they carry an accent bar, and other changes step back. The view opens scrolled to them. */
  emphasis?: readonly Emphasis[]
  /**
   * What of the diff is on screen, for a caller that keeps it, as the code view keeps it for each file: `onView` hears
   * every change, such as Show more, and the view no longer scrolls by itself. Else the view keeps its own.
   */
  view?: ShownView
  onView?: (view: ShownView) => void
  /** Two columns, old on the left and new on the right. One column otherwise. */
  split?: boolean
  /** The lines that are selected. Clicking a line number selects that line, and Shift with a click extends to it. */
  selection?: Emphasis | null
  onSelect?: (selection: Emphasis | null) => void
  /** Called instead of `onSelect` with the line whose number was clicked, its column, and whether Shift was held, for a caller that keeps a cursor. */
  onLine?: (line: DiffLine, column: 'old' | 'new', extend: boolean) => void
  /** Ranges that carry something, drawn as a small count beside their first line. */
  marks?: readonly LineMark[]
  /** Notes by kind, drawn beside their first line in a column of the gutter kept for them: given, even empty, the column is always there. */
  glyphs?: readonly LineGlyph[]
  cursor?: LineCursor | null
  /** A row drawn under a line, or over the first line when `after` is null, such as the input of a note being written. It is always drawn, in view or not. */
  insert?: { after: LinePlace | null; key: string; node: ReactNode } | null
  /** Up, Down and the page keys scroll the view when the keyboard is in it, as in the code panel. False leaves them to a cursor that walks the lines. */
  scrollKeys?: boolean
  /** Called once with how long the first lines took to be on screen, in milliseconds. */
  onFirstLines?: (ms: number) => void
  /** Drawn whole at its own height, for a page that scrolls around it: no virtual list and no scrolling of its own. */
  natural?: boolean
  /** With `natural`, only the first this many rows are drawn. */
  rows?: number
  ref?: Ref<DiffViewHandle>
  className?: string
}

/**
 * A file's change, drawn like a diff on GitHub: added and removed lines tinted, old and new line numbers,
 * changed words tinted more strongly, three unchanged lines around each group, and controls to see more.
 *
 * It stands alone: give it a file's two sides, or a patch. It knows nothing of the review or the graph.
 * Long files are drawn with a virtual list, and highlighting runs in a worker.
 */
export function DiffView({
  file,
  patch,
  diff: given,
  emphasis,
  view: kept,
  onView,
  split = false,
  selection = null,
  onSelect,
  onLine,
  marks,
  glyphs,
  cursor,
  insert,
  scrollKeys = true,
  onFirstLines,
  natural = false,
  rows,
  ref,
  className,
}: DiffViewProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const started = useRef(performance.now())
  const description = useMemo(() => describeFile(file), [file])
  const diff = useMemo(() => given ?? (patch ? diffFromPatch(patch) : diffOf(file.base, file.head)), [given, file.base, file.head, patch])
  const controlled = kept != null
  const [own, setOwn] = useState(() => startView(diff, emphasis))
  const view = kept ?? own
  const setView = (next: (now: ShownView) => ShownView) => (kept ? onView?.(next(kept)) : setOwn(next))
  // A new file, or new lines to point at, starts from the changes again.
  useLayoutEffect(() => {
    started.current = performance.now()
    if (!controlled) setOwn(startView(diff, emphasis))
  }, [controlled, diff, emphasis])

  const items = useMemo<(DiffItem | SplitItem)[]>(() => (split ? splitRows(diff, view) : unifiedRows(diff, view)), [diff, split, view])
  const language = languageOf(file.path)
  // A patch carries no whole file to highlight, so its lines are drawn plain.
  const head = useHighlighted(patch ? null : file.head, language)
  const base = useHighlighted(patch || file.base === file.head ? null : file.base, language)
  const pointing = (emphasis?.length ?? 0) > 0

  // The inserted row sits under the row of its line, else over the first. Rows after it are one further down the list.
  const insertAt = insert ? (insert.after ? rowOfLine(items, insert.after.side, insert.after.line) + 1 : 0) : -1
  const itemAt = (index: number): DiffItem | SplitItem | null => (insertAt < 0 || index < insertAt ? items[index]! : index === insertAt ? null : items[index - 1]!)
  const indexOf = (at: LinePlace | 'insert') => {
    if (at === 'insert') return insertAt
    const index = rowOfLine(items, at.side, at.line)
    return index >= 0 && insertAt >= 0 && index >= insertAt ? index + 1 : index
  }
  const virtual = useVirtualizer({
    count: natural ? 0 : items.length + (insertAt >= 0 ? 1 : 0),
    getScrollElement: () => scroller.current,
    estimateSize: (index) => {
      const item = itemAt(index)
      return item == null ? INSERTED_HEIGHT : item.type === 'gap' ? 30 : LINE_HEIGHT
    },
    overscan: 24,
    getItemKey: (index) => itemAt(index)?.key ?? `insert:${insert?.key ?? ''}`,
    // The inserted row is drawn wherever the view is, so what it holds, such as a field that takes the keyboard, is there.
    rangeExtractor: (range: Range) => (insertAt < 0 ? defaultRangeExtractor(range) : [...new Set([...defaultRangeExtractor(range), insertAt])].sort((a, b) => a - b)),
  })

  // Open on the lines pointed at: the first of them that changed, or the first of them. A caller that keeps the view scrolls it.
  const target = useMemo(() => openingIndex(items, view.emphasis), [items, view.emphasis])
  const aimed = useRef<unknown>(null)
  useLayoutEffect(() => {
    if (controlled || aimed.current === view.emphasis || items.length === 0) return
    aimed.current = view.emphasis
    if (target >= 0) virtual.scrollToIndex(Math.max(0, target - 3), { align: 'start' })
    else scroller.current?.scrollTo({ top: 0 })
  }, [controlled, items.length, target, view.emphasis, virtual])

  const reported = useRef<unknown>(null)
  useEffect(() => {
    if (reported.current === diff || items.length === 0) return
    // The next frame is when the first lines are really on screen.
    const frame = requestAnimationFrame(() => {
      reported.current = diff
      onFirstLines?.(performance.now() - started.current)
    })
    return () => cancelAnimationFrame(frame)
  }, [diff, items.length, onFirstLines])

  /** The lines on screen of one side, top to bottom. */
  const linesOf = (side: Emphasis['side']) => {
    const numbers: number[] = []
    for (const item of items) {
      const candidates = item.type === 'line' ? [item.line] : item.type === 'row' ? [item.left, item.right] : []
      for (const line of candidates) {
        const number = side === 'added' ? (line?.kind !== 'removed' ? line?.newLine : undefined) : line?.kind !== 'added' ? line?.oldLine : undefined
        if (number != null && numbers.at(-1) !== number) numbers.push(number)
      }
    }
    return numbers
  }
  const pick = (line: DiffLine, extend: boolean, column: 'old' | 'new') => {
    if (onLine) return onLine(line, column, extend)
    const side: Emphasis['side'] = line.kind === 'removed' ? 'deleted' : 'added'
    const number = side === 'deleted' ? line.oldLine : line.newLine
    if (number == null || !onSelect) return
    if (extend && selection && selection.side === side) onSelect({ side, startLine: Math.min(selection.startLine, number), endLine: Math.max(selection.endLine, number) })
    else if (selection && selection.side === side && selection.startLine === number && selection.endLine === number) onSelect(null)
    else onSelect({ side, startLine: number, endLine: number })
  }
  const picks = onSelect || onLine ? pick : undefined

  useImperativeHandle(
    ref,
    () => ({
      moveSelection: (delta) => {
        if (!onSelect) return
        if (!selection) {
          // Start on the first changed line the view points at, or the first changed line there is.
          const first = (test: (line: DiffLine) => boolean) => items.flatMap((item) => (item.type === 'line' ? [item.line] : item.type === 'row' ? [item.right, item.left].filter((line) => line != null) : [])).find(test)
          const line = first((entry) => entry.emphasis && entry.kind !== 'context') ?? first((entry) => entry.kind !== 'context') ?? first(() => true)
          if (line) pick(line, false, line.kind === 'removed' ? 'old' : 'new')
          return
        }
        const numbers = linesOf(selection.side)
        const end = numbers.indexOf(selection.endLine)
        if (delta > 0 && numbers[end + 1] != null) onSelect({ ...selection, endLine: numbers[end + 1]! })
        else if (delta < 0 && selection.endLine > selection.startLine) onSelect({ ...selection, endLine: numbers[Math.max(0, end - 1)] ?? selection.startLine })
        else if (delta < 0) {
          const start = numbers.indexOf(selection.startLine)
          if (numbers[start - 1] != null) onSelect({ ...selection, startLine: numbers[start - 1]! })
        }
      },
      showMore: () => setView((now) => showMoreEverywhere(diff, now)),
      showWholeFile: () => setView(showWholeFile),
      scrollBy: (lines) => scroller.current?.scrollBy({ top: lines * LINE_HEIGHT }),
      keepInView: (at) => {
        const index = indexOf(at)
        if (index < 0) return
        // A row not drawn is far out of view: the list finds its place as it measures the rows on the way.
        const drawn = virtual.getVirtualItems().find((row) => row.index === index)
        if (!drawn) return virtual.scrollToIndex(index, { align: 'center' })
        const offset = virtual.scrollOffset ?? 0
        const next = stableScroll(offset, virtual.scrollRect?.height ?? 0, drawn.start, drawn.end)
        if (next !== offset) virtual.scrollToOffset(next)
      },
      pageLines: () => Math.max(1, Math.floor((virtual.scrollRect?.height ?? 0) / LINE_HEIGHT) - 1),
    }),
    // `items`, `selection` and `onSelect` are read when a key asks, and a new handle each draw costs nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [diff, split, items, selection, onSelect, onLine, kept, insertAt],
  )

  const lineProps = { base, head, dim: pointing, selection, marks, glyphs, cursor, onPick: picks }
  const draw = (item: DiffItem | SplitItem) =>
    item.type === 'gap' ? (
      <Gap item={item} whole={!diff.partial} onMore={(direction) => setView((now) => expandGap(now, item.id, direction))} onWhole={() => setView(showWholeFile)} />
    ) : item.type === 'line' ? (
      <Line line={item.line} numbers="both" {...lineProps} />
    ) : (
      <div className="dv-split">
        <Line line={item.left} numbers="old" {...lineProps} />
        <Line line={item.right} numbers="new" {...lineProps} />
      </div>
    )

  if (description.note) {
    return (
      <div className={`dv ${className ?? ''}`}>
        <p className="dv-note">{description.note}</p>
        {insert ? <div className="dv-insert">{insert.node}</div> : null}
      </div>
    )
  }

  if (natural) {
    return (
      <div className={`dv ${className ?? ''}`} style={{ height: 'auto', overflow: 'visible' }} aria-label={`Changes in ${description.title}`} data-rv-code>
        {items.slice(0, rows).map((item) => (
          <div key={item.key}>{draw(item)}</div>
        ))}
      </div>
    )
  }

  return (
    <div ref={scroller} className={`dv ${className ?? ''}`} tabIndex={0} aria-label={`Changes in ${description.title}`} data-rv-code={scrollKeys || undefined} data-glyphs={glyphs ? '' : undefined}>
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {virtual.getVirtualItems().map((row) => {
          const item = itemAt(row.index)
          return (
            <div key={row.key} ref={virtual.measureElement} data-index={row.index} className="dv-row" style={{ transform: `translateY(${row.start}px)` }}>
              {item ? draw(item) : <div className="dv-insert">{insert?.node}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface LineProps {
  line: DiffLine | undefined
  numbers: 'both' | 'old' | 'new'
  base: HighlightedText
  head: HighlightedText
  dim: boolean
  selection: Emphasis | null
  marks: readonly LineMark[] | undefined
  /** Given, the line keeps a cell of the gutter for its notes' glyphs. */
  glyphs?: readonly LineGlyph[] | undefined
  cursor?: LineCursor | null | undefined
  onPick: ((line: DiffLine, extend: boolean, column: 'old' | 'new') => void) | undefined
}

const Line = memo(function Line({ line, numbers, base, head, dim, selection, marks, glyphs, cursor, onPick }: LineProps) {
  if (!line) return <div className="dv-line" data-kind="none">{glyphs ? <span className="dv-glyph" /> : null}</div>
  // A removed line is read from the old side. Every other line is as it stands in the new one.
  const source = line.kind === 'removed' ? base : head
  const number = line.kind === 'removed' ? line.oldLine : line.newLine
  const tokens: Highlighted['lines'][number] | undefined = number == null ? undefined : source.lines[number - 1]
  // An unchanged line is on both sides, so a range of either side can hold it.
  const within = (range: Emphasis) => {
    const at = lineNumberOn(line, range.side)
    return at != null && range.startLine <= at && at <= range.endLine
  }
  const starts = (range: Emphasis) => lineNumberOn(line, range.side) === range.startLine
  const mark = marks?.find(starts)
  const noted = glyphs?.filter(starts)
  const comments = noted?.reduce((sum, range) => sum + range.comments, 0) ?? 0
  const questions = noted?.reduce((sum, range) => sum + range.questions, 0) ?? 0
  const column = numbers === 'old' ? 'old' : numbers === 'new' ? 'new' : line.kind === 'removed' ? 'old' : 'new'
  const onCursor = cursor != null && lineNumberOn(line, cursor.side) === cursor.line && (numbers === 'both' || cursor.column === column)
  const pickable = onPick ? { role: 'button', title: 'Select this line for a note', onClick: (event: React.MouseEvent) => onPick(line, event.shiftKey, column) } : {}

  return (
    <div
      className="dv-line"
      data-kind={line.kind}
      data-emphasis={line.emphasis}
      data-dim={dim && line.kind !== 'context' && !line.emphasis}
      data-selected={selection != null && within(selection)}
      data-noted={(marks?.some(within) || glyphs?.some(within)) ?? false}
      data-cursor={onCursor ? (cursor.quiet ? 'quiet' : 'true') : undefined}
    >
      {mark ? <i className="dv-count" aria-label={`${mark.count} ${mark.count === 1 ? 'note' : 'notes'}`}>{mark.count}</i> : null}
      {glyphs ? (
        <span className="dv-glyph" aria-label={comments + questions > 0 ? noteWords(comments, questions) : undefined}>
          {comments > 0 ? <i data-kind="comment" /> : null}
          {questions > 0 ? <i data-kind="question" /> : null}
        </span>
      ) : null}
      {numbers !== 'new' ? (
        <span className="dv-no" {...pickable}>
          {line.oldLine ?? ''}
        </span>
      ) : null}
      {numbers !== 'old' ? (
        <span className="dv-no" {...pickable}>
          {line.newLine ?? ''}
        </span>
      ) : null}
      <span className="dv-mark" aria-hidden="true">
        {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''}
      </span>
      <code className="dv-code">
        {line.text === ''
          ? '​'
          : segmentsOf(line.text, tokens, line.words).map((segment, index) => {
              const style = source.styles[segment.style]
              return (
                <span
                  key={index}
                  className={segment.word ? 'dv-word' : undefined}
                  style={style ? tokenStyle(style) : undefined}
                  data-li={style && style.lightFont & FONT.italic ? '' : undefined}
                  data-di={style && style.darkFont & FONT.italic ? '' : undefined}
                  data-lb={style && style.lightFont & FONT.bold ? '' : undefined}
                  data-db={style && style.darkFont & FONT.bold ? '' : undefined}
                >
                  {segment.text}
                </span>
              )
            })}
      </code>
    </div>
  )
})

/** "1 comment", "2 comments and a question". */
function noteWords(comments: number, questions: number): string {
  const count = (value: number, word: string) => (value === 0 ? null : value === 1 ? `a ${word}` : `${value} ${word}s`)
  const words = [count(comments, 'comment'), count(questions, 'question')].filter(Boolean).join(' and ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function Gap({ item, whole, onMore, onWhole }: { item: Extract<DiffItem, { type: 'gap' }>; whole: boolean; onMore: (direction: 'above' | 'below') => void; onWhole: () => void }) {
  return (
    <div className="dv-gap">
      <span>{item.hidden === 1 ? '1 line' : `${item.hidden.toLocaleString('en-US')} lines`}</span>
      {item.below ? (
        <button type="button" onClick={() => onMore('below')} aria-label="Show more below the lines above">
          <ChevronDown />
          Show more
        </button>
      ) : null}
      {item.above ? (
        <button type="button" onClick={() => onMore('above')} aria-label="Show more above the lines below">
          <ChevronUp />
          Show more
        </button>
      ) : null}
      {whole ? (
        <button type="button" onClick={onWhole}>
          <UnfoldVertical />
          Whole file
        </button>
      ) : null}
    </div>
  )
}

/** A diff's line and its band of held-back lines as `DiffView` draws them, for a page that draws a diff's rows in colors it already holds. */
export { Line as DiffLineRow, Gap as DiffGapRow }
