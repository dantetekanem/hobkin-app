import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronUp, UnfoldVertical } from 'lucide-react'
import { memo, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react'
import './code.css'
import {
  describeFile,
  diffFromPatch,
  diffOf,
  expandGap,
  showWholeFile,
  splitRows,
  startView,
  unifiedRows,
  type DiffItem,
  type DiffLine,
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

export interface DiffViewHandle {
  /** Reveals twenty more lines around every group. For a key, where a button cannot be pointed at. */
  showMore(): void
  showWholeFile(): void
  scrollBy(lines: number): void
  /** Grows or shrinks the selection by one line, starting one when there is none. For Shift with Up and Down. */
  moveSelection(delta: 1 | -1): void
}

/** Lines of one side with a count, such as how many notes they carry. */
export interface LineMark extends Emphasis {
  count: number
}

export interface DiffViewProps {
  /** The file's two sides. A side is null where the file does not exist. */
  file: FileSides
  /** A patch to draw instead, when the two sides are not at hand. The gaps between its hunks cannot be opened. */
  patch?: string
  /** Lines to point at: they carry an accent bar, and other changes step back. The view opens scrolled to them. */
  emphasis?: readonly Emphasis[]
  /** Two columns, old on the left and new on the right. One column otherwise. */
  split?: boolean
  /** The lines that are selected. Clicking a line number selects that line, and Shift with a click extends to it. */
  selection?: Emphasis | null
  onSelect?: (selection: Emphasis | null) => void
  /** Ranges that carry something, drawn as a small count beside their first line. */
  marks?: readonly LineMark[]
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
export function DiffView({ file, patch, emphasis, split = false, selection = null, onSelect, marks, onFirstLines, natural = false, rows, ref, className }: DiffViewProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const started = useRef(performance.now())
  const description = useMemo(() => describeFile(file), [file])
  const diff = useMemo(() => (patch ? diffFromPatch(patch) : diffOf(file.base, file.head)), [file.base, file.head, patch])
  const [view, setView] = useState(() => startView(diff, emphasis))
  // A new file, or new lines to point at, starts from the changes again.
  useLayoutEffect(() => {
    started.current = performance.now()
    setView(startView(diff, emphasis))
  }, [diff, emphasis])

  const items = useMemo<(DiffItem | SplitItem)[]>(() => (split ? splitRows(diff, view) : unifiedRows(diff, view)), [diff, split, view])
  const language = languageOf(file.path)
  // A patch carries no whole file to highlight, so its lines are drawn plain.
  const head = useHighlighted(patch ? null : file.head, language)
  const base = useHighlighted(patch || file.base === file.head ? null : file.base, language)
  const pointing = (emphasis?.length ?? 0) > 0

  const virtual = useVirtualizer({
    count: natural ? 0 : items.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => (items[index]?.type === 'gap' ? 30 : LINE_HEIGHT),
    overscan: 24,
    getItemKey: (index) => items[index]!.key,
  })

  // Open on the lines pointed at: the first of them that changed, or the first of them.
  const target = useMemo(() => openingIndex(items, view.emphasis), [items, view.emphasis])
  const aimed = useRef<unknown>(null)
  useLayoutEffect(() => {
    if (aimed.current === view.emphasis || items.length === 0) return
    aimed.current = view.emphasis
    if (target >= 0) virtual.scrollToIndex(Math.max(0, target - 3), { align: 'start' })
    else scroller.current?.scrollTo({ top: 0 })
  }, [items.length, target, view.emphasis, virtual])

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
  const pick = (line: DiffLine, extend: boolean) => {
    const side: Emphasis['side'] = line.kind === 'removed' ? 'deleted' : 'added'
    const number = side === 'deleted' ? line.oldLine : line.newLine
    if (number == null || !onSelect) return
    if (extend && selection && selection.side === side) onSelect({ side, startLine: Math.min(selection.startLine, number), endLine: Math.max(selection.endLine, number) })
    else if (selection && selection.side === side && selection.startLine === number && selection.endLine === number) onSelect(null)
    else onSelect({ side, startLine: number, endLine: number })
  }

  useImperativeHandle(
    ref,
    () => ({
      moveSelection: (delta) => {
        if (!onSelect) return
        if (!selection) {
          // Start on the first changed line the view points at, or the first changed line there is.
          const first = (test: (line: DiffLine) => boolean) => items.flatMap((item) => (item.type === 'line' ? [item.line] : item.type === 'row' ? [item.right, item.left].filter((line) => line != null) : [])).find(test)
          const line = first((entry) => entry.emphasis && entry.kind !== 'context') ?? first((entry) => entry.kind !== 'context') ?? first(() => true)
          if (line) pick(line, false)
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
      showMore: () =>
        setView((now) => {
          let next = now
          for (const item of split ? splitRows(diff, now) : unifiedRows(diff, now)) {
            if (item.type !== 'gap') continue
            if (item.above) next = expandGap(next, item.id, 'above')
            if (item.below) next = expandGap(next, item.id, 'below')
          }
          return next
        }),
      showWholeFile: () => setView(showWholeFile),
      scrollBy: (lines) => scroller.current?.scrollBy({ top: lines * LINE_HEIGHT }),
    }),
    // `items`, `selection` and `onSelect` are read when a key asks, and a new handle each draw costs nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [diff, split, items, selection, onSelect],
  )

  const draw = (item: DiffItem | SplitItem) =>
    item.type === 'gap' ? (
      <Gap item={item} whole={!diff.partial} onMore={(direction) => setView((now) => expandGap(now, item.id, direction))} onWhole={() => setView(showWholeFile)} />
    ) : item.type === 'line' ? (
      <Line line={item.line} numbers="both" base={base} head={head} dim={pointing} selection={selection} marks={marks} onPick={onSelect ? pick : undefined} />
    ) : (
      <div className="dv-split">
        <Line line={item.left} numbers="old" base={base} head={head} dim={pointing} selection={selection} marks={marks} onPick={onSelect ? pick : undefined} />
        <Line line={item.right} numbers="new" base={base} head={head} dim={pointing} selection={selection} marks={marks} onPick={onSelect ? pick : undefined} />
      </div>
    )

  if (description.note) {
    return (
      <div className={`dv ${className ?? ''}`}>
        <p className="dv-note">{description.note}</p>
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
    <div ref={scroller} className={`dv ${className ?? ''}`} tabIndex={0} aria-label={`Changes in ${description.title}`} data-rv-code>
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {virtual.getVirtualItems().map((row) => {
          const item = items[row.index]!
          return (
            <div key={row.key} ref={virtual.measureElement} data-index={row.index} className="dv-row" style={{ transform: `translateY(${row.start}px)` }}>
              {draw(item)}
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
  onPick: ((line: DiffLine, extend: boolean) => void) | undefined
}

const Line = memo(function Line({ line, numbers, base, head, dim, selection, marks, onPick }: LineProps) {
  if (!line) return <div className="dv-line" data-kind="none" />
  // A removed line is read from the old side. Every other line is as it stands in the new one.
  const source = line.kind === 'removed' ? base : head
  const number = line.kind === 'removed' ? line.oldLine : line.newLine
  const tokens: Highlighted['lines'][number] | undefined = number == null ? undefined : source.lines[number - 1]
  const side: Emphasis['side'] = line.kind === 'removed' ? 'deleted' : 'added'
  const within = (range: Emphasis) => range.side === side && number != null && range.startLine <= number && number <= range.endLine
  const mark = marks?.find((range) => range.side === side && range.startLine === number)
  const pickable = onPick ? { role: 'button', title: 'Select this line for a note', onClick: (event: React.MouseEvent) => onPick(line, event.shiftKey) } : {}

  return (
    <div
      className="dv-line"
      data-kind={line.kind}
      data-emphasis={line.emphasis}
      data-dim={dim && line.kind !== 'context' && !line.emphasis}
      data-selected={selection != null && within(selection)}
      data-noted={marks?.some(within) ?? false}
    >
      {mark ? <i className="dv-count" aria-label={`${mark.count} ${mark.count === 1 ? 'note' : 'notes'}`}>{mark.count}</i> : null}
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
