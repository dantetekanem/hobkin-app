import { Check, Columns2, Rows2, UnfoldVertical } from 'lucide-react'
import { motion, useTransform } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import type { Unit } from '#shared/review/assessment.ts'
import { hashLines } from '#shared/review/lines.ts'
import type { Note } from '#shared/review/notes.ts'
import type { Review, ReviewFile, ReviewFileContents } from '#shared/review/types.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/utils.ts'
import { ModeSwitch } from '../Chrome.tsx'
import { revealLines, type Diff, type Emphasis } from '../code/diff-rows.ts'
import { DiffView, type DiffViewHandle, type LineCursor, type LineGlyph } from '../code/DiffView.tsx'
import type { KeyPress } from '../keys.ts'
import type { AskCommand } from '../panel/ask.ts'
import { MENU } from '../panel/Header.tsx'
import { NoteInput } from '../panel/notes.tsx'
import { reviewMemory, useReviewMemory, useRig, useSession, useSessionStore, useSource } from '../state/context.tsx'
import { fileSeen, placeOfPart } from '../state/look.ts'
import { reviewNodesOf, type Session } from '../state/session.ts'
import { codeKey, type CodeKeyChange, type CodeKeyState } from './code-keys.ts'
import './code-view.css'
import { changeAt, clicked, cursorIn, lineAt, rangeOf, rowsOf, type Cursor } from './cursor.ts'
import { FILE_ROW, FileList } from './FileList.tsx'
import { fileRows, storyOrder } from './files.ts'
import { codeViewStore, diffOfRead, placeOf, startOf, type CodeViewStore, type FilePlace } from './view-state.ts'

/** The open code view's own keys. The review asks here first while the code view is its look (`KeyEffects.codeKey`). */
let openViewKey: ((press: KeyPress) => boolean) | null = null

/**
 * A key in the code view (spec 071): the cursor, the selection, the files, the groups of changes, the seen mark and the
 * view. False for any other key, which the review takes. Escape here takes a selection of several lines back to the
 * cursor's line, and says whether it did.
 */
export function codeViewKey(press: KeyPress): boolean {
  return openViewKey?.(press) ?? false
}

/** How long a word from the review stays in the line at the bottom: as long as it floats over the graph (`NOTICE_MS` in Chrome.tsx). */
const NOTICE_MS = 2600

const orders = new WeakMap<Session['view'], { review: Review; files: ReviewFile[] }>()
/** The files the code view lists, worked out once for each view of the review. */
function orderOf(review: Review, view: Session['view']): ReviewFile[] {
  const kept = orders.get(view)
  if (kept?.review === review) return kept.files
  const nodes = new Map(review.nodes.map((node) => [node.id, node]))
  const files = storyOrder(review.files, view.story, (id) => reviewNodesOf(view, id), (id) => nodes.get(id))
  orders.set(view, { review, files })
  return files
}

/** The file the code view shows: the one the session names when it lists it, else its first. */
function shownFile(files: readonly ReviewFile[], named: string | null): string | null {
  if (files.some((file) => file.id === named)) return named
  return files[0]?.id ?? null
}

/** The file the session's code view shows now. */
const fileNow = (session: Session) => shownFile(orderOf(session.review, session.view), session.diff.file)

/** The lines selected, as the session holds them for a note: with the hash of their text on their side. */
function linesOf(file: ReviewFileContents, range: Emphasis): NonNullable<Session['selection']> {
  const text = (range.side === 'added' ? file.head : file.base) ?? ''
  return { kind: 'lines', fileId: file.fileId, ...range, hash: hashLines(text, range.startLine, range.endLine) }
}

function sameLines(a: Session['selection'], b: Session['selection']): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return a.fileId === b.fileId && a.side === b.side && a.startLine === b.startLine && a.endLine === b.endLine && a.hash === b.hash
}

/** The notes on a file's lines, by range, as glyphs: how many comments and questions start on each. */
function glyphsOf(notes: readonly Note[], fileId: string | null): LineGlyph[] {
  const ranges = new Map<string, LineGlyph>()
  for (const note of notes) {
    const { target } = note
    if (target.kind !== 'lines' || target.fileId !== fileId) continue
    const key = `${target.side}:${target.startLine}:${target.endLine}`
    const glyph = ranges.get(key) ?? { side: target.side, startLine: target.startLine, endLine: target.endLine, comments: 0, questions: 0 }
    if (note.intent === 'question') glyph.questions += 1
    else glyph.comments += 1
    ranges.set(key, glyph)
  }
  return [...ranges.values()]
}

/** Z, R and the header's check: a file's seen mark goes on or comes off, and a file with no part to mark says so. */
function toggleSeen(session: Session, fileId: string): void {
  if (!session.toggleFileSeen(fileId)) session.say('This file has no part to mark seen.')
}

/** What the code view's keys read, as it is now, from the session, the code view's state and the window's choice of columns. */
function keyState(session: Session, code: CodeViewStore, pages: { lines: number; files: number }): CodeKeyState {
  const files = orderOf(session.review, session.view)
  const file = shownFile(files, session.diff.file)
  const state = code.getState()
  const place = placeOf(state.places, file)
  const diff = diffOfRead(file ? state.files[file] : undefined)
  return {
    pane: state.pane,
    files: files.map((each) => ({ id: each.id, seen: fileSeen(session.review.nodes, each, session.seen) })),
    file,
    diff,
    view: diff ? (place.view ?? startOf(diff)) : null,
    cursor: place.cursor,
    split: reviewMemory.getState().splitDiff,
    page: pages.lines,
    filesPage: pages.files,
  }
}

/** Takes in what a key changed of the code view, its file and the session. */
function applyChange(change: CodeKeyChange, session: Session, code: CodeViewStore, file: string | null): void {
  if (change.pane) code.setState({ pane: change.pane })
  if (file && (change.cursor || change.view)) {
    const kept: Partial<FilePlace> = {}
    if (change.cursor) kept.cursor = change.cursor
    if (change.view) kept.view = change.view
    code.place(file, kept)
  }
  if (change.file) session.showFile(change.file)
  if (change.split != null) reviewMemory.getState().setSplitDiff(change.split)
  if (change.seen) toggleSeen(session, change.seen)
  if (change.say) session.say(change.say)
}

/**
 * The review's code view (spec 071): the change as a diff, one file at a time, the way pi-coder's `/diff` shows it. The
 * changed files are listed at the left in the story's order, and the chosen file's diff is beside them, under its path,
 * the group of changes the cursor is in, its size and what is selected. It opens with the files focused: Up and Down
 * change the file, and Enter or Right go to the diff, where a cursor walks the changed lines and Shift selects. A note
 * is about the selected lines, or about the file while the files are focused, and the review's own input opens right
 * under its lines. Notes show in a column of the gutter kept for them. At the bottom, one line: the switch between the
 * looks, the keys to start with, and the review's short words. Nothing floats over the code.
 *
 * It belongs to the review's canvas, under the frame's menus and right of the review's panel, and ends where the proof
 * beside the review starts.
 */
export function CodeView({ ask, units, verdict }: { ask: AskCommand | null; units?: readonly Unit[]; verdict?: ReactNode }) {
  const store = useSessionStore()
  const source = useSource()
  const rig = useRig()
  const code = codeViewStore(store)
  const review = useSession((session) => session.review)
  const reviewView = useSession((session) => session.view)
  const notes = useSession((session) => session.notes)
  const seen = useSession((session) => session.seen)
  const asked = useSession((session) => session.diff)
  const editor = useSession((session) => session.editor)
  const selection = useSession((session) => session.selection)
  const notice = useSession((session) => session.notice)
  const split = useReviewMemory((memory) => memory.splitDiff)
  const pane = useStore(code, (state) => state.pane)
  const places = useStore(code, (state) => state.places)
  const reads = useStore(code, (state) => state.files)

  const files = useMemo(() => orderOf(review, reviewView), [review, reviewView])
  const rows = useMemo(() => fileRows(files, { nodes: review.nodes, notes, seen }), [files, notes, review.nodes, seen])
  const file = shownFile(files, asked.file)
  const shown = files.find((each) => each.id === file)
  const read = file ? reads[file] : undefined
  // The file's two sides, once read.
  const contents = read && !('failed' in read) ? read : null
  const diff = diffOfRead(read)
  const place = placeOf(places, file)
  const view = diff ? (place.view ?? startOf(diff)) : null
  const drawn = useMemo(() => (diff && view ? rowsOf(diff, view, split) : null), [diff, split, view])
  const cursor = useMemo(() => (drawn ? cursorIn(drawn, split, place.cursor) : null), [drawn, place.cursor, split])

  const section = useRef<HTMLElement>(null)
  const diffView = useRef<DiffViewHandle>(null)
  const list = useRef<HTMLDivElement>(null)
  /** Set by a move: the next draw scrolls the diff to keep the cursor, or the input of a note being written, in sight. */
  const keepInSight = useRef(false)

  // The session names a file the code view does not list, or none yet: it shows its first.
  useEffect(() => {
    const listed = files.some((each) => each.id === asked.file)
    if (files[0] && !listed) store.getState().showFile(files[0].id)
  }, [asked.file, files, store])

  // A step, a part or a note asked to show a file: its kept cursor, or the lines asked for, selected, with the diff focused.
  // Opened from the graph's code panel, the code view starts on the lines selected there, which the session keeps.
  const opening = useRef(true)
  useLayoutEffect(() => {
    const first = opening.current
    opening.current = false
    if (asked.ask === code.getState().handled) return
    code.setState({ handled: asked.ask })
    keepInSight.current = true

    const kept = store.getState().selection
    const lines = first && kept?.fileId === asked.file ? kept : asked.at
    if (!lines || !asked.file) return
    const { side, startLine, endLine } = lines
    code.place(asked.file, {
      // The cursor on the first of the lines, with all of them selected.
      cursor: { side, line: startLine, anchor: endLine, column: side === 'deleted' ? 'old' : 'new' },
      reveal: { side, startLine, endLine },
    })
    code.setState({ pane: 'diff' })
  }, [asked, code, store])

  // The lines asked for are opened once the file is read, and the cursor goes to the nearest line drawn.
  useLayoutEffect(() => {
    if (!file || !diff || !view || !place.reveal) return
    const { side, startLine, endLine } = place.reveal
    const opened = revealLines(diff, view, side, startLine, endLine)
    const cursorNow = cursorIn(rowsOf(diff, opened, split), split, place.cursor)
    code.place(file, { view: opened, cursor: cursorNow, reveal: null })
    keepInSight.current = true
  }, [code, diff, file, place.cursor, place.reveal, split, view])

  // The file shown, and the ones beside it in the list, are read from the source once each.
  useEffect(() => {
    const at = files.findIndex((each) => each.id === file)
    for (const id of [file, files[at + 1]?.id, files[at - 1]?.id]) {
      if (!id || code.getState().files[id] || code.reading.has(id)) continue
      code.reading.add(id)
      const keep = (read: ReviewFileContents | { failed: string }) => {
        code.reading.delete(id)
        code.setState((state) => ({ files: { ...state.files, [id]: read } }))
      }
      const fail = (error: unknown) => keep({ failed: error instanceof Error ? error.message : 'The file did not load.' })
      source.getFile(review.id, id).then(keep, fail)
    }
  }, [code, file, files, review.id, source])

  // While the diff has the keyboard, the session's selection is the cursor's lines, so a note is about them. While the
  // files have it, there is none, and a note is about the file.
  useEffect(() => {
    const wanted = pane === 'diff' && cursor && contents ? linesOf(contents, rangeOf(cursor)) : null
    if (!sameLines(selection, wanted)) store.getState().selectLines(wanted)
  }, [contents, cursor, pane, selection, store])

  // A note opened about lines of another file the code view lists goes to that file, and its input with it. Gone to
  // another file while it is written, the note closes and its words wait as a draft, as Escape leaves them, and the
  // keyboard goes back to the review.
  const seenWith = useRef<{ editor: Session['editor']; file: string | null }>({ editor: null, file: null })
  useLayoutEffect(() => {
    const before = seenWith.current
    seenWith.current = { editor, file }
    if (!editor) return
    keepInSight.current = true

    const { target } = editor
    const part = target.kind === 'node' ? review.nodes.find((node) => node.id === target.node) : undefined
    const noteFile = target.kind === 'lines' ? target.fileId : part ? placeOfPart(part, review.files)?.fileId : undefined
    if (!noteFile || noteFile === file || !files.some((each) => each.id === noteFile)) return
    if (before.editor !== editor) {
      const at = target.kind === 'lines' ? { side: target.side, startLine: target.startLine, endLine: target.endLine } : null
      store.getState().showFile(noteFile, at)
    } else if (before.file !== file) {
      store.getState().closeEditor()
      section.current?.closest<HTMLElement>('[data-rv-root]')?.focus({ preventScroll: true })
    }
  }, [editor, file, files, review, store])

  // Its lines are drawn, so the input can open under them.
  useLayoutEffect(() => {
    const target = editor?.target
    if (!file || !diff || !view || target?.kind !== 'lines' || target.fileId !== file) return
    const opened = revealLines(diff, view, target.side, target.startLine, target.endLine)
    if (opened !== view) code.place(file, { view: opened })
  }, [code, diff, editor, file, view])

  const noteInput = useMemo(() => <NoteInput ask={ask} units={units} />, [ask, units])
  const target = editor?.target
  // The input of a note opens under its lines in this file, else over the diff's first line, as one about the file.
  const insert = useMemo(() => {
    if (!target) return null
    const elsewhere = target.kind === 'lines' && target.fileId !== file && files.some((each) => each.id === target.fileId)
    if (elsewhere) return null
    const after = target.kind === 'lines' && target.fileId === file ? { side: target.side, line: target.endLine } : null
    return { after, key: 'note', node: noteInput }
  }, [file, files, noteInput, target])

  // After a move, the diff keeps the cursor in sight, or the input while a note is written.
  useLayoutEffect(() => {
    const handle = diffView.current
    if (!keepInSight.current || !handle) return
    keepInSight.current = false
    if (insert) handle.keepInView('insert')
    else if (cursor) handle.keepInView(cursor)
  })

  useEffect(() => {
    const pressKey = (press: KeyPress): boolean => {
      const session = store.getState()
      const pages = {
        lines: diffView.current?.pageLines() ?? 20,
        files: Math.max(1, Math.floor((list.current?.clientHeight ?? 0) / FILE_ROW) - 1),
      }
      const state = keyState(session, code, pages)
      const change = codeKey(press, state)
      if (!change) return false

      applyChange(change, session, code, state.file)
      if (change.scroll === 'keep' || change.view || change.split != null) keepInSight.current = true
      if (typeof change.scroll === 'number') {
        // A page: the view scrolls as far as the cursor moved, and once it has, the cursor is kept in sight.
        diffView.current?.scrollBy(change.scroll)
        requestAnimationFrame(() => {
          const kept = placeOf(code.getState().places, fileNow(store.getState())).cursor
          if (kept) diffView.current?.keepInView(kept)
        })
      }
      return true
    }
    openViewKey = pressKey
    return () => {
      openViewKey = null
    }
  })

  // The whole width but the proof's at the right: the review's panel is the graph's (the user, 2026-11-25).
  const right = useTransform(() => rig.proof.get())

  const glyphs = useMemo(() => glyphsOf(notes, file), [file, notes])
  const cursorBar = useMemo<LineCursor | null>(() => (cursor ? { side: cursor.side, line: cursor.line, column: cursor.column, quiet: pane !== 'diff' } : null), [cursor, pane])
  const selectedLines = useMemo(() => (pane === 'diff' && cursor ? rangeOf(cursor) : null), [cursor, pane])

  const show = (fileId: string) => {
    code.setState({ pane: 'files' })
    store.getState().showFile(fileId)
  }
  const toDiff = () => {
    if (code.getState().pane !== 'diff') code.setState({ pane: 'diff' })
  }

  const body = (() => {
    if (!shown) return <DiffMessage>This change has no changed files to show.</DiffMessage>
    if (!contents || !diff || !view) {
      const failed = read && 'failed' in read ? read.failed : null
      return <DiffMessage insert={insert?.node}>{failed ?? 'Reading the file…'}</DiffMessage>
    }
    return (
      <DiffView
        key={shown.id}
        ref={diffView}
        file={contents}
        diff={diff}
        view={view}
        onView={(next) => code.place(shown.id, { view: next })}
        split={split}
        selection={selectedLines}
        cursor={cursorBar}
        glyphs={glyphs}
        insert={insert}
        onLine={(line, column, extend) => {
          code.place(shown.id, { cursor: clicked(cursor, line, column, extend, split) })
          toDiff()
        }}
        scrollKeys={false}
      />
    )
  })()

  return (
    <motion.section ref={section} aria-label="Code" className="cv absolute bottom-0 z-20 flex flex-col bg-code-bg text-code-text" style={{ top: MENU.bottom, left: 0, right }}>
      <div className="grid min-h-0 flex-1 grid-cols-[clamp(220px,26%,340px)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
        <FileList rows={rows} active={file} focused={pane === 'files'} onPick={show} list={list} />
        <div className="flex min-h-0 min-w-0 flex-col" onPointerDown={toDiff}>
          <DiffHead
            file={shown}
            diff={diff}
            cursor={cursor}
            kind={drawn && cursor ? lineAt(drawn, cursor)?.kind : undefined}
            focused={pane === 'diff'}
            split={split}
            seen={shown ? fileSeen(review.nodes, shown, seen) : false}
            onSeen={() => shown && toggleSeen(store.getState(), shown.id)}
            onSplit={() => reviewMemory.getState().setSplitDiff(!split)}
            onWhole={() => diffView.current?.showWholeFile()}
          />
          <div className="min-h-0 flex-1">{body}</div>
        </div>
      </div>
      <Foot notice={notice} verdict={verdict} />
    </motion.section>
  )
}

/** A line said in place of the diff, with the input of a note under it while one is written. */
function DiffMessage({ children, insert }: { children: ReactNode; insert?: ReactNode }) {
  return (
    <div className="dv">
      <p className="dv-note">{children}</p>
      {insert ? <div className="dv-insert">{insert}</div> : null}
    </div>
  )
}

/** What is selected, in words: the cursor's line, the lines from where the selection started, or the file. */
function selectedWords(cursor: Cursor | null, kind: string | undefined, focused: boolean): string {
  if (!focused || !cursor) return 'a note is about the file'
  const { side, startLine, endLine } = rangeOf(cursor)
  if (startLine !== endLine) return `${side === 'deleted' ? 'old lines' : 'lines'} ${startLine} to ${endLine}`
  if (kind === 'added') return `added line ${startLine}`
  if (kind === 'removed') return `removed line ${startLine}`
  return side === 'deleted' ? `old line ${startLine}` : `line ${startLine}`
}

/** Which group of changes the cursor is in, in words: "Change 2 of 5", or where it is between them. */
function changeWords(at: ReturnType<typeof changeAt> | null): string {
  if (!at || at.total === 0) return 'No change'
  if (at.inside) return `Change ${at.index + 1} of ${at.total}`
  if (at.index < 0) return `Before change 1 of ${at.total}`
  return `After change ${at.index + 1} of ${at.total}`
}

/**
 * Over the diff: the file's path, old → new for a rename; which group of changes the cursor is in, the file's added and
 * removed lines, one column or two, and what is selected. Two lines at a fixed height, with the file's seen mark, the
 * columns and the whole file at its right.
 */
function DiffHead({ file, diff, cursor, kind, focused, split, seen, onSeen, onSplit, onWhole }: {
  file: ReviewFile | undefined
  diff: Diff | null
  cursor: Cursor | null
  kind: string | undefined
  focused: boolean
  split: boolean
  seen: boolean
  onSeen: () => void
  onSplit: () => void
  onWhole: () => void
}) {
  const path = file?.oldPath && file.oldPath !== file.path ? `${file.oldPath} → ${file.path}` : file?.path
  const where = changeWords(diff && cursor ? changeAt(diff, cursor) : null)
  return (
    <header className="flex h-[54px] shrink-0 items-center gap-1 pr-2 pl-4 shadow-[inset_0_-1px_0_var(--cv-line)]">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[13px] leading-5 font-medium" title={path}>
          {path ?? ' '}
        </p>
        <p className="truncate font-heading text-[12.5px] leading-5 text-[var(--cv-quiet)] tabular-nums">
          {diff ? (
            <>
              {where} · <span className="text-ok-fg">+{diff.additions}</span> <span className="text-bad-fg">−{diff.deletions}</span> · {split ? 'two columns' : 'one column'} ·{' '}
              <span className={cn(focused && 'text-code-text')}>{selectedWords(cursor, kind, focused)}</span>
            </>
          ) : (
            ' '
          )}
        </p>
      </div>
      <HeadButton label={seen ? 'Seen: take the mark off' : 'Mark the file seen'} keys="Z" pressed={seen} onClick={onSeen}>
        <Check className={cn(seen && 'text-ok-fg')} />
      </HeadButton>
      <HeadButton label={split ? 'One column' : 'Two columns'} keys="V" onClick={onSplit}>
        {split ? <Rows2 /> : <Columns2 />}
      </HeadButton>
      <HeadButton label="Whole file" keys="F" onClick={onWhole}>
        <UnfoldVertical />
      </HeadButton>
    </header>
  )
}

/** A round button over the diff, with its name and key in a tooltip. It leaves the keyboard where it is. */
function HeadButton({ label, keys, pressed, onClick, children }: { label: string; keys: string; pressed?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-pressed={pressed}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClick}
            className="grid size-8 shrink-0 place-items-center rounded-full transition-[background-color,transform] duration-[160ms] ease-[var(--ease-out)] hover:bg-[color-mix(in_oklab,var(--hb-code-text)_12%,transparent)] active:scale-[0.94] [&_svg]:size-4"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>
        {label} <Kbd>{keys}</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The line at the bottom: the switch between the looks, the keys to start with, as pi-coder's footer has them, the
 * review's short words, each for a moment, where they move nothing, and at the right the verdict. The keys give way
 * first when the line is narrow.
 */
function Foot({ notice, verdict }: { notice: Session['notice']; verdict?: ReactNode }) {
  const [said, setSaid] = useState<string | null>(null)
  // A word said before the code view opened is not said again.
  const heard = useRef(notice?.key)
  useEffect(() => {
    if (!notice || notice.key === heard.current) return
    heard.current = notice.key
    setSaid(notice.text)
    const gone = setTimeout(() => setSaid(null), NOTICE_MS)
    return () => clearTimeout(gone)
  }, [notice])
  const hint = (keys: string, words: string, first = false) => (
    <span className="flex h-5 shrink-0 items-center gap-1.5">
      {first ? null : (
        <span aria-hidden="true" className="mr-1">
          ·
        </span>
      )}
      <Kbd>{keys}</Kbd>
      {words}
    </span>
  )
  return (
    <footer className="flex h-12 shrink-0 items-center gap-2.5 bg-background px-3 text-[12.5px] whitespace-nowrap text-muted-foreground shadow-[0_-1px_0_var(--cv-line)]">
      <ModeSwitch />
      {/* The keys to start with, which give way to the verdict: one that does not fit wraps out of sight whole. For a
          moment the review's short words take their place. */}
      <span className="relative flex h-5 min-w-0 flex-1 items-center">
        <span className={cn('ml-1.5 flex h-5 min-w-0 flex-1 flex-wrap items-center gap-x-2.5 overflow-hidden', said && 'invisible')}>
          {hint('C', 'a comment', true)}
          {hint('D', 'discuss with the agent')}
          {hint('⌘/', 'every key')}
        </span>
        <span role="status" className="absolute inset-0 truncate pl-1.5 font-heading text-[13px] leading-5 font-medium text-foreground">
          {said}
        </span>
      </span>
      {verdict}
    </footer>
  )
}
