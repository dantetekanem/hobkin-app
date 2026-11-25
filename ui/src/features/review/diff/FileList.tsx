import { Check } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type Ref } from 'react'
import { cn } from '@/lib/utils.ts'
import { shortenPath, totalsOf, type FileRow, type StatusLetter } from './files.ts'

/** The height of each row of the list: what a row says never changes it. */
export const FILE_ROW = 28
/** A character of the list: 12px JetBrains Mono, whose characters are 0.6em wide. */
const CHAR = 12 * 0.6

const STATUS: Record<StatusLetter, { color: string; word: string }> = {
  A: { color: 'text-ok-fg', word: 'Added' },
  M: { color: 'text-sun-fg', word: 'Changed' },
  D: { color: 'text-bad-fg', word: 'Deleted' },
  R: { color: 'text-code-fg', word: 'Renamed' },
}

const count = (value: number) => value.toLocaleString('en-US')

/**
 * The changed files beside the diff (spec 071), in the story's order, as pi-coder's `/diff` lists them: "N files · +X −Y"
 * on top, and for each its status letter in its color, its path shortened from the left, its added and removed lines in
 * columns, its comments and questions, and a check once it is seen, else a dot while a part of it needs the reviewer. The file
 * shown is marked, with the cursor's accent while the keyboard is here. A click shows a file, and leaves the keyboard
 * where it is.
 */
export function FileList({ rows, active, focused, onPick, list }: {
  rows: readonly FileRow[]
  active: string | null
  /** The keyboard is in the list. */
  focused: boolean
  onPick: (fileId: string) => void
  /** The list's scroller, whose height says how many files a page is. */
  list?: Ref<HTMLDivElement>
}) {
  const scroller = useRef<HTMLDivElement | null>(null)
  const ruler = useRef<HTMLSpanElement>(null)
  // How many characters a path has room for: the width of the path's column, the same in every row. Measured before the
  // list is first painted; until then, about what a window 1440 pixels wide gives it.
  const [room, setRoom] = useState(18)
  const totals = totalsOf(rows)
  const digits = (key: 'additions' | 'deletions' | 'comments' | 'questions') => Math.max(1, ...rows.map((row) => count(row[key]).length))
  // Every column but the path's is as wide as its widest row needs, so the rows line up and a note moves no column.
  const columns = `1.2ch minmax(0,1fr) ${digits('additions') + 1}ch ${digits('deletions') + 1}ch ${digits('comments') + digits('questions') + 3.6}ch 1.9ch`

  useLayoutEffect(() => {
    const element = ruler.current
    if (!element) return
    const measure = () => setRoom(Math.max(4, Math.floor(element.clientWidth / CHAR)))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [rows.length > 0])

  // The file shown stays in view, with the least scrolling. Every row is as tall as the next.
  const at = rows.findIndex((row) => row.file.id === active)
  useLayoutEffect(() => {
    const element = scroller.current
    if (!element || at < 0) return
    const top = at * FILE_ROW
    if (top < element.scrollTop) element.scrollTop = top
    else if (top + FILE_ROW > element.scrollTop + element.clientHeight) element.scrollTop = top + FILE_ROW - element.clientHeight
  }, [at])

  return (
    <div className="cv-files flex min-h-0 min-w-0 flex-col" data-focused={focused}>
      <p className="flex h-[34px] shrink-0 items-center gap-1 px-3 font-heading text-[12.5px] font-semibold tabular-nums">
        {count(totals.files)} {totals.files === 1 ? 'file' : 'files'}
        <span className="text-[var(--cv-quiet)]">·</span>
        <span className="text-ok-fg">+{count(totals.additions)}</span>
        <span className="text-bad-fg">−{count(totals.deletions)}</span>
      </p>
      <div
        ref={(element) => {
          scroller.current = element
          if (typeof list === 'function') list(element)
          else if (list) list.current = element
        }}
        className="rv-scroll relative min-h-0 flex-1 overflow-y-auto pb-2"
      >
        <ul aria-label="Changed files">
          {rows.map((row, index) => {
            const status = STATUS[row.letter]
            const renamed = row.file.oldPath != null && row.file.oldPath !== row.file.path
            const short = shortenPath(row.file.path, room)
            const cut = short.lastIndexOf('/') + 1
            const about = [
              renamed ? `${row.file.oldPath} → ${row.file.path}` : row.file.path,
              status.word,
              row.needsYou ? 'a part needs you' : null,
              row.seen ? 'seen' : null,
            ].filter(Boolean)
            return (
              <li key={row.file.id}>
                <button
                  type="button"
                  title={about.join(' · ')}
                  aria-current={row.file.id === active ? 'true' : undefined}
                  data-active={row.file.id === active}
                  // The keyboard stays where it is: in the review, with the code view's own keys.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onPick(row.file.id)}
                  className="cv-file grid w-full items-center gap-x-[0.5ch] px-2 text-left font-mono text-[12px]"
                  style={{ gridTemplateColumns: columns, height: FILE_ROW }}
                >
                  <span className={cn('font-semibold', status.color)} aria-label={status.word}>
                    {row.letter}
                  </span>
                  <span ref={index === 0 ? ruler : undefined} className="min-w-0 truncate">
                    <span className="text-[var(--cv-quiet)]">{short.slice(0, cut)}</span>
                    {short.slice(cut)}
                  </span>
                  <span className={cn('text-right tabular-nums text-ok-fg', row.additions === 0 && 'opacity-40')}>+{count(row.additions)}</span>
                  <span className={cn('text-right tabular-nums text-bad-fg', row.deletions === 0 && 'opacity-40')}>−{count(row.deletions)}</span>
                  <span className="flex items-center justify-end gap-[0.6ch] text-[11.5px] tabular-nums">
                    {row.comments > 0 ? (
                      <span className="flex items-center gap-[0.3ch]" aria-label={`${row.comments} ${row.comments === 1 ? 'comment' : 'comments'}`}>
                        <i className="cv-note" data-kind="comment" />
                        {row.comments}
                      </span>
                    ) : null}
                    {row.questions > 0 ? (
                      <span className="flex items-center gap-[0.3ch] text-sun-fg" aria-label={`${row.questions} ${row.questions === 1 ? 'question' : 'questions'}`}>
                        <i className="cv-note" data-kind="question" />
                        {row.questions}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center justify-end">
                    {row.seen ? <Check className="size-3.5 text-ok-fg" aria-label="Seen" /> : row.needsYou ? <i className="cv-needs" aria-label="A part needs you" /> : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
