import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { requestCanvasFocus } from '@/app/focus.ts'
import { useRemembered } from '@/app/location.ts'
import { Rise } from '@/app/Reveal.tsx'
import { SCREEN_COLUMN, SCREEN_SCROLLER } from '@/app/screen-layout.ts'
import { useStops } from '@/app/stops.ts'
import { useView } from '@/app/view-store.ts'
import { Button } from '@/components/ui/button.tsx'
import { useQuestions } from '@/features/questions/store.ts'
import { type Answer } from '@/features/questions/queue.ts'
import { rowVariants, useArriving, type Leaving } from '@/features/reports/list-motion.ts'
import { NoticeLine, REPLY_LINE_MS, type Line } from '@/features/reports/NoticeLine.tsx'
import { slideVariants } from '@/features/reports/slide.ts'
import { useStill } from '@/features/reports/still.ts'
import { useReports } from '@/features/reports/store.ts'
import { reveal, slideTo } from '@/features/routines/aside.ts'
import { runCommand } from '@/lib/host/client.ts'
import { OpenItem } from './Decision.tsx'
import { ItemCard } from './ItemCard.tsx'
import { stepInRow, type WaitingRow } from './items.ts'
import { PileTile } from './Pile.tsx'
import { sampleReviewFor } from './sample.ts'
import { finishedReviewId } from '@/features/review/entry.ts'
import { answerSample, startAnswering, stopAnswering, useActionItems, useWaitingRows } from './store.ts'

/**
 * Action Items: everything waiting on the user, the one that has waited longest first. A row opens as Reports opens
 * a report: the screen slides aside, and the item's whole decision card comes in, with everything waiting listed
 * beside it. The answer goes to hobkin through its own action: one of the choices, or the user's own words where
 * hobkin takes them. A sample is answered in this window only. What hobkin keeps elsewhere (a report to read, work to
 * finish) opens where it is handled. This file is the entry the frame mounts. Spec: 012-reports-actions.
 */
export function ActionsScreen() {
  const root = useRef<HTMLDivElement | null>(null)
  useStops(root)
  const still = useStill()
  const rows = useWaitingRows()
  const sample = useActionItems((state) => state.sample)
  const shown = useRef(rows)
  shown.current = rows
  /** The sample question this screen raised on the sheet, so the keyboard comes back to the right place. */
  const asking = useRef<string | null>(null)
  const lineKey = useRef(1)
  const [leaving, setLeaving] = useState<Leaving>('filtered')
  const [line, setLine] = useState<Line | null>(null)
  // The open item, and which way the layer and its card last slid, as in Reports (0: arrives with the screen).
  const [openId, setOpenId] = useRemembered('action')
  const [aside, setAside] = useState<0 | 1 | -1>(0)
  const [step, setStep] = useState<0 | 1 | -1>(0)
  const slides = useMemo(() => slideVariants(still), [still])
  const open = rows.find((row) => row.id === openId) ?? null
  const variants = useMemo(() => rowVariants(still), [still])
  const arriving = useArriving()
  const now = Date.now()
  let order = 0

  /** Puts the keyboard on a row once React has drawn it, or on the first row, or on the sample question. */
  const focusLater = (id: string | null) =>
    requestAnimationFrame(() => {
      const element = root.current
      const row = (id ? element?.querySelector<HTMLElement>(`[data-item-row="${CSS.escape(id)}"]`) : null) ?? element?.querySelector<HTMLElement>('[data-stop]')
      reveal(element, row)
      row?.focus({ preventScroll: true })
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

  // The sample question leaves the sheet: answered, the keyboard comes back to the button that asked it; put off,
  // to the row it now has here.
  useEffect(
    () =>
      useQuestions.subscribe(({ queue }) => {
        const asked = asking.current
        if (!asked || queue.waiting.some((question) => question.id === asked)) return
        asking.current = null
        if (!queue.answered.some((entry) => entry.id === asked)) return focusLater(asked)
        requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[data-sample-question]')?.focus({ preventScroll: true }))
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

  const openItem = (row: WaitingRow) => {
    if (row.opens) return openWhereHandled(row.opens)
    setAside(1)
    setStep(0)
    setOpenId(row.id)
  }
  // From the list beside the card: the next card slides in from the side its item lies on.
  const switchTo = (row: WaitingRow) => {
    if (row.opens) return openWhereHandled(row.opens)
    const at = (id: string | null) => rows.findIndex((each) => each.id === id)
    if (row.id !== openId) setStep(at(row.id) > at(openId) ? 1 : -1)
    setOpenId(row.id)
  }
  // Back to the list, onto the row it came from, or the one that takes an answered one's place.
  const close = (to: string | null = openId) => {
    setAside(-1)
    setOpenId(null)
    focusLater(to)
  }
  const answer = (row: WaitingRow, given: Answer) => {
    const list = shown.current
    const at = list.findIndex((each) => each.id === row.id)
    setLeaving('answered')
    if (row.answers) giveToHobkin(row, given)
    else answerSample(row.id, given)
    close((list[at + 1] ?? list[at - 1])?.id ?? null)
  }

  const askSample = () => {
    if (!useActionItems.getState().sample) return
    const before = new Set(useQuestions.getState().queue.waiting.map(({ id }) => id))
    useQuestions.getState().raiseSample()
    asking.current = useQuestions.getState().queue.waiting.find(({ id }) => !before.has(id))?.id ?? null
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
      <motion.div ref={root} layoutScroll inert={open !== null} className={`${SCREEN_SCROLLER} pb-16`} onKeyDownCapture={onKeyDownCapture}>
        {/* The list slides aside while an item is open, as the week does in Reports, and stays as it was. It spans the
            canvas, centered by its padding, so sliding its own width takes all of it out of view. */}
        <motion.div className={`flex flex-col gap-3 ${SCREEN_COLUMN}`} initial={false} animate={slideTo(open ? slides.exit : slides.center, 1)}>
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
                  onAsk={openItem}
                  onReview={review}
                />
              ))}
            </AnimatePresence>
          </ul>

          <Rise className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 pt-1">
            <p className="text-[12px] text-muted-foreground">
              {sample
                ? "Sample data. hobkin's own items show here once the host is connected."
                : 'Enter opens an item to answer, or opens it where it is handled. Right reaches the links.'}
            </p>
            {sample ? (
              <Button variant="ghost" size="sm" data-stop="" data-sample-question="" onClick={askSample}>
                Ask a sample question
              </Button>
            ) : null}
          </Rise>
        </motion.div>
      </motion.div>
      <AnimatePresence custom={aside}>
        {open ? (
          <OpenItem
            key="open"
            rows={rows}
            row={open}
            sample={sample}
            now={now}
            slides={slides}
            aside={aside}
            step={step}
            onSwitch={switchTo}
            onClose={() => close()}
            onAnswer={answer}
            onReview={review}
          />
        ) : null}
      </AnimatePresence>
      {/* What hobkin said of an answer, at the foot of the screen. */}
      <NoticeLine line={line} onUndo={() => {}} />
    </div>
  )
}
