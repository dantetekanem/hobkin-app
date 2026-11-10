import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { focusInput } from '@/app/keys.ts'
import { Rise } from '@/app/Reveal.tsx'
import { useStops } from '@/app/stops.ts'
import { tween } from '@/lib/motion.ts'
import { KINDS, KindChoice, TitleFilter } from './Controls.tsx'
import { byDay, filterReports, isUnread, neighbor, newestFirst, successor, type KindFilter } from './inbox.ts'
import { reportsKey, type Where } from './keys.ts'
import { rowVariants, useArriving, type Leaving } from './list-motion.ts'
import { NoticeLine, REPLY_LINE_MS, type Line } from './NoticeLine.tsx'
import { Overview } from './Overview.tsx'
import { Reader } from './Reader.tsx'
import { replyToReport } from './reply.ts'
import { DayHeading, ReportRow } from './ReportRow.tsx'
import { useStill } from './still.ts'
import { useReports } from './store.ts'

/** Where the keyboard is, as the screen's key map counts it. */
function whereOf(target: Element): Where {
  if (target.closest('[data-reader]')) return 'reader'
  if (target.closest('[data-report-row]')) return 'row'
  if (target.closest('[data-kind-filter]')) return 'kind'
  if (target.closest('[data-title-filter]')) return 'title'
  return 'other'
}

const LINE_STEP = 56
/** How long a smooth scroll counts as still on its way. */
const SCROLL_GLIDE_MS = 350

/**
 * Reports: what finished runs brought back, newest first, with hobkin's three filters and a title filter. A
 * report opens in a reader that grows out of its row, beside the list on a wide canvas and over it on a narrow
 * one. From there the report can go with the next message, or be deleted with a moment to undo.
 * This file is the entry the frame mounts. Spec: 012-reports-actions.
 */
export function ReportsScreen() {
  const root = useRef<HTMLDivElement | null>(null)
  const titleField = useRef<HTMLInputElement | null>(null)
  const lineKey = useRef(1)
  const scrollGoal = useRef<{ page: HTMLElement; top: number; at: number } | null>(null)
  useStops(root)
  const still = useStill()

  const sample = useReports((state) => state.sample)
  const inbox = useReports((state) => state.inbox)
  const kind = useReports((state) => state.kind)
  const title = useReports((state) => state.title)
  const openId = useReports((state) => state.openId)
  const { setKind, setTitle, open, close, remove, undo } = useReports.getState()

  const [origin, setOrigin] = useState<DOMRect | null>(null)
  const [direction, setDirection] = useState<1 | -1>(1)
  const [leaving, setLeaving] = useState<Leaving>('filtered')
  const [line, setLine] = useState<Line | null>(() =>
    inbox.removed ? { key: 0, kind: 'deleted', title: inbox.removed.report.title, until: inbox.removed.until } : null,
  )

  const ordered = useMemo(() => newestFirst(inbox.reports), [inbox.reports])
  const list = useMemo(() => filterReports(ordered, { kind, title }), [ordered, kind, title])
  const counts = useMemo(
    () => Object.fromEntries(KINDS.map(({ value }) => [value, filterReports(ordered, { kind: value, title }).length])) as Record<KindFilter, number>,
    [ordered, title],
  )
  const now = Date.now()
  const groups = useMemo(() => byDay(list, Date.now()), [list])
  const variants = useMemo(() => rowVariants(still), [still])
  const arriving = useArriving()
  let order = 0
  const openReport = openId ? (inbox.reports.find((report) => report.id === openId) ?? null) : null
  const openAt = openId ? list.findIndex((report) => report.id === openId) + 1 : 0

  // The undo line goes once the delete stands, or once it was undone from elsewhere.
  useEffect(() => {
    if (!inbox.removed) setLine((shown) => (shown?.kind === 'deleted' ? null : shown))
  }, [inbox.removed])

  // The line about a reply stays a few seconds.
  useEffect(() => {
    if (line?.kind !== 'replying') return
    const timer = setTimeout(() => setLine((shown) => (shown?.key === line.key ? null : shown)), REPLY_LINE_MS)
    return () => clearTimeout(timer)
  }, [line])

  // When the frame hands the keyboard to the screen, it lands where the reading is: the open report, or the
  // newest one. Up from the first report reaches the filters. Registered after `useStops`, so this has the last word.
  useEffect(() => {
    const element = root.current
    const screen = element?.closest<HTMLElement>('[data-canvas-screen]')
    if (!element || !screen) return
    const land = (event: FocusEvent) => {
      if (event.target !== screen) return
      const target =
        element.querySelector<HTMLElement>('[data-reader]') ??
        element.querySelector<HTMLElement>('[data-report-row][aria-current="true"]') ??
        element.querySelector<HTMLElement>('[data-report-row]')
      target?.focus({ preventScroll: true })
    }
    screen.addEventListener('focus', land)
    // The frame may hand the keyboard over before this screen has loaded. Then it is already waiting here.
    if (document.activeElement === screen) land({ target: screen } as unknown as FocusEvent)
    return () => screen.removeEventListener('focus', land)
  }, [])

  const rowOf = (id: string) => root.current?.querySelector<HTMLElement>(`[data-report-row="${CSS.escape(id)}"]`) ?? null
  // After React has drawn the change, so the element is the one now on screen.
  const focusLater = (find: () => HTMLElement | null | undefined) => requestAnimationFrame(() => find()?.focus({ preventScroll: false }))
  const focusReader = () => requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[data-reader]')?.focus({ preventScroll: true }))

  const chooseKind = (next: KindFilter) => {
    setLeaving('filtered')
    setKind(next)
  }
  const chooseTitle = (next: string) => {
    setLeaving('filtered')
    setTitle(next)
  }

  const openFrom = (id: string, from: HTMLElement | null) => {
    if (openId && openReport) {
      // Already reading: the page slides over to the other report, in the direction it lies in the list.
      if (id !== openId) setDirection(list.findIndex((report) => report.id === id) > list.findIndex((report) => report.id === openId) ? 1 : -1)
    } else {
      setOrigin(from?.getBoundingClientRect() ?? null)
      setDirection(1)
    }
    open(id)
    focusReader()
  }

  const closeReader = () => {
    if (!openId) return
    // The row comes into view first, so the reader has somewhere to go back into.
    rowOf(openId)?.scrollIntoView({ block: 'nearest' })
    const id = openId
    close()
    focusLater(() => rowOf(id) ?? root.current?.querySelector<HTMLElement>('[data-report-row]'))
  }

  const step = (delta: 1 | -1) => {
    if (!openId) return
    const next = neighbor(list, openId, delta)
    if (!next) return
    setDirection(delta)
    open(next.id)
    rowOf(next.id)?.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' })
  }

  const scrollReader = (by: 'line' | 'page' | 'all', delta: 1 | -1) => {
    if (!openId) return
    const page = root.current?.querySelector<HTMLElement>(`[data-reader-page="${CSS.escape(openId)}"]`)
    if (!page) return
    const most = page.scrollHeight - page.clientHeight
    // A key held down, or pressed again while the page is still gliding, goes on from where the last one was headed.
    const goal = scrollGoal.current
    const from = goal && goal.page === page && performance.now() - goal.at < SCROLL_GLIDE_MS ? goal.top : page.scrollTop
    const step = by === 'line' ? LINE_STEP : page.clientHeight * 0.85
    const top = by === 'all' ? (delta > 0 ? most : 0) : Math.max(0, Math.min(most, from + delta * step))
    scrollGoal.current = { page, top, at: performance.now() }
    page.scrollTo({ top, behavior: still ? 'auto' : 'smooth' })
  }

  const reply = (id: string) => {
    const report = inbox.reports.find((entry) => entry.id === id)
    if (!report) return
    replyToReport(report)
    setLine({ key: lineKey.current++, kind: 'replying', title: report.title })
    // As in the terminal app: the keyboard goes to the message, where the reply is written.
    focusInput()
  }

  const deleteReport = (id: string) => {
    if (!sample) return
    const report = inbox.reports.find((entry) => entry.id === id)
    if (!report) return
    const after = successor(list, id)
    setLeaving('deleted')
    remove(id)
    const removed = useReports.getState().inbox.removed
    if (removed) setLine({ key: lineKey.current++, kind: 'deleted', title: report.title, until: removed.until })
    focusLater(() => (after ? rowOf(after.id) : root.current?.querySelector<HTMLElement>('[data-kind-filter] [data-stop]')))
  }

  const undoDelete = () => {
    const removed = useReports.getState().inbox.removed
    if (!removed) return
    undo()
    setLine(null)
    focusLater(() => rowOf(removed.report.id))
  }

  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || !(event.target instanceof Element)) return
    const target = event.target
    const where = whereOf(target)
    const action = reportsKey(
      { key: event.key, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey },
      { where, titleEmpty: title === '', canUndo: line?.kind === 'deleted' && inbox.removed !== null },
    )
    if (!action) return
    // The key is used here, so neither the walk between controls nor the frame takes it too.
    event.preventDefault()
    const row = target.closest<HTMLElement>('[data-report-row]')
    const subject = where === 'reader' ? openId : (row?.dataset.reportRow ?? null)

    switch (action.do) {
      case 'open':
        if (subject) openFrom(subject, row)
        return
      case 'open-first':
        if (list[0]) openFrom(list[0].id, rowOf(list[0].id))
        return
      case 'close':
        return closeReader()
      case 'step':
        return step(action.delta)
      case 'scroll':
        return scrollReader(action.by, action.delta)
      case 'kind': {
        const at = KINDS.findIndex((option) => option.value === kind)
        const next = KINDS[(at + action.delta + KINDS.length) % KINDS.length]!.value
        root.current?.querySelector<HTMLElement>(`[data-kind="${next}"]`)?.focus()
        return chooseKind(next)
      }
      case 'find':
        titleField.current?.focus()
        titleField.current?.select()
        return
      case 'clear-title':
        return chooseTitle('')
      case 'reply':
        if (subject) reply(subject)
        return
      case 'delete':
        if (subject) deleteReport(subject)
        return
      case 'undo':
        return undoDelete()
    }
  }

  return (
    <div ref={root} className="relative h-full" onKeyDownCapture={onKeyDownCapture}>
      <div className="grid h-full min-h-0 grid-cols-[minmax(300px,380px)_minmax(0,1fr)] grid-rows-1 gap-3 px-3 pt-[70px] pb-3 @max-[800px]:grid-cols-1">
        {/* The week, or the open report. First in reading order: it is the largest piece, so it lands first. */}
        <div className="pointer-events-none relative col-start-2 row-start-1 min-h-0 @max-[800px]:absolute @max-[800px]:inset-x-3 @max-[800px]:top-[70px] @max-[800px]:bottom-3 @max-[800px]:z-10">
          <AnimatePresence>
            {openReport ? (
              <Reader
                key="reader"
                report={openReport}
                origin={origin}
                direction={direction}
                at={openAt}
                of={list.length}
                onStep={step}
                onClose={closeReader}
                onReply={() => reply(openReport.id)}
                onDelete={sample ? () => deleteReport(openReport.id) : undefined}
              />
            ) : (
              <Overview key="overview" list={list} read={inbox.read} now={now} onOpen={openFrom} />
            )}
          </AnimatePresence>
        </div>

        <div className="relative col-start-1 row-start-1 flex min-h-0 flex-col">
          <Rise className="flex flex-col gap-2 px-1 pt-2 pb-3">
            <KindChoice kind={kind} counts={counts} onChoose={chooseKind} />
            <TitleFilter value={title} onChange={chooseTitle} field={titleField} />
          </Rise>

          <motion.div layoutScroll className="scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain pb-20">
            <ul className="relative flex flex-col" aria-label="Reports">
              <AnimatePresence mode="popLayout" custom={leaving}>
                {groups.flatMap((group) => [
                  <DayHeading key={`day:${group.key}`} label={group.label} variants={variants} order={arriving ? order++ : -1} />,
                  ...group.reports.map((report) => (
                    <ReportRow
                      key={report.id}
                      report={report}
                      unread={isUnread(inbox, report.id)}
                      open={report.id === openId}
                      variants={variants}
                      order={arriving ? order++ : -1}
                      onOpen={openFrom}
                    />
                  )),
                ])}
              </AnimatePresence>
            </ul>
            <AnimatePresence initial={false}>
              {list.length === 0 ? (
                <motion.p
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: tween.enter }}
                  exit={{ opacity: 0, transition: tween.exit }}
                  className="px-3 py-8 text-center text-[14px] text-muted-foreground"
                >
                  {inbox.reports.length === 0 ? 'No reports yet.' : title ? 'No report titles match. Esc clears the filter.' : 'No reports of this kind.'}
                </motion.p>
              ) : null}
            </AnimatePresence>
            <p className="px-3 pt-6 text-[12px] text-muted-foreground">
              {sample ? "Sample data. hobkin's own reports show here once the host is connected." : 'Reports from your hobkin. Read marks stay in this window. Deleting reports is not connected yet.'}
            </p>
          </motion.div>
          {/* At the foot of the list, under the rows it is about. */}
          <NoticeLine line={line} onUndo={undoDelete} />
        </div>
      </div>
    </div>
  )
}
