import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { requestCanvasFocus } from '@/app/focus.ts'
import { Rise } from '@/app/Reveal.tsx'
import { useStops } from '@/app/stops.ts'
import { useView } from '@/app/view-store.ts'
import { Button } from '@/components/ui/button.tsx'
import { useQuestions } from '@/features/questions/store.ts'
import { type Answer } from '@/features/questions/queue.ts'
import { rowVariants, useArriving, type Leaving } from '@/features/reports/list-motion.ts'
import { NoticeLine, REPLY_LINE_MS, type Line } from '@/features/reports/NoticeLine.tsx'
import { useStill } from '@/features/reports/still.ts'
import { useReports } from '@/features/reports/store.ts'
import { runCommand } from '@/lib/host/client.ts'
import { ItemCard } from './ItemCard.tsx'
import { stepInRow, type WaitingRow } from './items.ts'
import { PileTile } from './Pile.tsx'
import { sampleReviewFor } from './sample.ts'
import { finishedReviewId } from '@/features/review/entry.ts'
import { startAnswering, stopAnswering, useActionItems, useWaitingRows } from './store.ts'

/** The question on the sheet that this screen raised, and from where, so the keyboard comes back to the right place. */
interface Asking {
  id: string
  from: 'row' | 'sample'
}

/**
 * Action Items: everything waiting on the user, the one that has waited longest first. A row opens the way a
 * question does, on the question sheet, and the answer goes to hobkin through its own decision action: one of the
 * choices, or the user's own words typed on the sheet. Read more shows the whole question, why, and hobkin's pick.
 * What hobkin keeps elsewhere (a report to read, work to finish) opens where it is handled.
 * This file is the entry the frame mounts. Spec: 012-reports-actions.
 */
export function ActionsScreen() {
  const root = useRef<HTMLDivElement | null>(null)
  useStops(root)
  const still = useStill()
  const rows = useWaitingRows()
  const sample = useActionItems((state) => state.sample)
  const shown = useRef(rows)
  shown.current = rows
  const asking = useRef<Asking | null>(null)
  const lineKey = useRef(1)
  const [leaving, setLeaving] = useState<Leaving>('filtered')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [line, setLine] = useState<Line | null>(null)
  const variants = useMemo(() => rowVariants(still), [still])
  const arriving = useArriving()
  const now = Date.now()
  let order = 0

  /** Puts the keyboard on a row once React has drawn it, or on the first row, or on the sample question. */
  const focusLater = (id: string | null) =>
    requestAnimationFrame(() => {
      const element = root.current
      const row = id ? element?.querySelector<HTMLElement>(`[data-item-row="${CSS.escape(id)}"]`) : null
      ;(row ?? element?.querySelector<HTMLElement>('[data-stop]'))?.focus()
    })

  /** One line at the foot of the screen with what hobkin said, for a few seconds. */
  const say = (text: string, refused = false) => setLine({ key: lineKey.current++, kind: 'said', text, refused })
  useEffect(() => {
    if (line?.kind !== 'said') return
    const timer = setTimeout(() => setLine((now) => (now?.key === line.key ? null : now)), REPLY_LINE_MS)
    return () => clearTimeout(timer)
  }, [line])

  /**
   * The answer goes to hobkin through its own action. The row leaves at once, and comes back if hobkin refuses,
   * with hobkin's reason on the line below.
   */
  const giveToHobkin = (row: WaitingRow, given: Answer) => {
    const answers = row.answers
    if (!answers) return
    if (answers.by === 'learning' && 'typed' in given) {
      say('A learning proposal takes one of its three choices.', true)
      return
    }
    startAnswering(row.id)
    const sent =
      answers.by === 'learning'
        ? runCommand('learning.answer', { id: answers.id, value: (given as { value: string }).value as 'yes' | 'later' | 'no' })
        : runCommand('decision.answer', 'typed' in given ? { id: answers.id, typed: given.typed } : { id: answers.id, value: given.value })
    sent.then(
      (result) => {
        stopAnswering(row.id)
        say(result.message || 'Answered.')
      },
      (error: unknown) => {
        stopAnswering(row.id)
        say(error instanceof Error ? error.message : String(error), true)
      },
    )
  }

  // The sheet asks. Once the question leaves it, an answer goes to hobkin, and the keyboard comes back here: to the
  // row that takes the answered one's place, or to the row that was put off.
  useEffect(
    () =>
      useQuestions.subscribe(({ queue }) => {
        const asked = asking.current
        if (!asked || queue.waiting.some((question) => question.id === asked.id)) return
        asking.current = null
        const answered = queue.answered.findLast((entry) => entry.id === asked.id)
        if (!answered) return focusLater(asked.id)
        setLeaving('answered')
        if (asked.from === 'sample') {
          requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[data-sample-question]')?.focus())
          return
        }
        const list = shown.current
        const at = list.findIndex((row) => row.id === asked.id)
        const row = list[at]
        if (row?.answers) giveToHobkin(row, answered.answer)
        focusLater((list[at + 1] ?? list[at - 1])?.id ?? null)
      }),
    [],
  )

  // The frame may hand the keyboard over before this screen has loaded. Then it is already waiting here.
  useEffect(() => {
    const screen = root.current?.closest<HTMLElement>('[data-canvas-screen]')
    if (screen && document.activeElement === screen) root.current?.querySelector<HTMLElement>('[data-stop]')?.focus()
  }, [])

  /** Something hobkin keeps elsewhere opens there, and the keyboard goes along. */
  const openWhereHandled = (opens: NonNullable<WaitingRow['opens']>) => {
    if (opens.screen === 'reports') useReports.getState().open(opens.report)
    const view = useView.getState()
    view.openScreen(opens.screen)
    view.engageCanvas()
    requestCanvasFocus()
  }

  const ask = (row: WaitingRow) => {
    if (row.opens) return openWhereHandled(row.opens)
    // A row that only says something has nothing to answer here.
    if (!row.question.choices.length) return
    asking.current = { id: row.id, from: 'row' }
    useQuestions.getState().raise(row.question)
  }

  const readMore = (row: WaitingRow) =>
    setExpanded((open) => {
      const next = new Set(open)
      if (!next.delete(row.id)) next.add(row.id)
      return next
    })

  const askSample = () => {
    if (!useActionItems.getState().sample) return
    const before = new Set(useQuestions.getState().queue.waiting.map(({ id }) => id))
    useQuestions.getState().raiseSample()
    const raised = useQuestions.getState().queue.waiting.find(({ id }) => !before.has(id))
    asking.current = raised ? { id: raised.id, from: 'sample' } : null
  }

  const review = (row: WaitingRow) => {
    if (!row.item) return
    if (useActionItems.getState().sample) return useView.getState().openReviewFor(sampleReviewFor(row.item))
    const target = row.item.answerTo
    if (target?.kind !== 'merge' || typeof target.slug !== 'string' || typeof target.item !== 'string') return
    const id = finishedReviewId({ slug: target.slug, item: target.item }, true)
    if (id) useView.getState().openReviewFor(id)
  }

  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || !(event.target instanceof HTMLElement)) return
    // Enter presses whatever has the keyboard. Taken here rather than left to the browser, so a key that comes
    // from hobkin's commands presses it the same way.
    if (event.key === 'Enter' && event.target.matches('button, a[href]')) {
      event.preventDefault()
      event.target.click()
      return
    }
    const card = event.target.closest<HTMLElement>('[data-item]')
    if (!card) return
    const main = card.querySelector<HTMLElement>('[data-item-row]')
    const controls = [...card.querySelectorAll<HTMLElement>('[data-row-control]')]
    const at = controls.indexOf(event.target)

    // Left and Right move along the row: from the row itself to its own controls and back.
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const next = stepInRow(at, event.key === 'ArrowRight' ? 1 : -1, controls.length)
      if (next !== at) (next === -1 ? main : controls[next])?.focus()
      event.preventDefault()
      return
    }
    if (at === -1) return
    if (event.key === 'Escape') {
      // One step back, onto the row.
      main?.focus()
      event.preventDefault()
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      // The walk between rows goes on from the row this control belongs to.
      main?.focus()
    }
  }

  return (
    <div className="relative h-full">
      <motion.div ref={root} layoutScroll className="scroll-quiet h-full overflow-y-auto px-6 pt-[78px] pb-16" onKeyDownCapture={onKeyDownCapture}>
        <div className="mx-auto flex max-w-[760px] flex-col gap-3">
          <PileTile rows={rows} now={now} />

          <ul className="relative flex flex-col gap-2" aria-label="Waiting on you">
            <AnimatePresence mode="popLayout" custom={leaving}>
              {rows.map((row) => (
                <ItemCard
                  key={row.id}
                  row={row}
                  now={now}
                  variants={variants}
                  order={arriving ? order++ : -1}
                  expanded={expanded.has(row.id)}
                  onAsk={ask}
                  onReview={review}
                  onReadMore={readMore}
                />
              ))}
            </AnimatePresence>
          </ul>

          <Rise className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 pt-1">
            <p className="text-[12px] text-muted-foreground">
              {sample
                ? "Sample data. hobkin's own items show here once the host is connected."
                : 'Enter answers, or opens where it is handled. Right reaches Read more and the links.'}
            </p>
            {sample ? (
              <Button variant="ghost" size="sm" data-stop="" data-sample-question="" onClick={askSample}>
                Ask a sample question
              </Button>
            ) : null}
          </Rise>
        </div>
      </motion.div>
      {/* What hobkin said of an answer, at the foot of the screen. */}
      <NoticeLine line={line} onUndo={() => {}} />
    </div>
  )
}
