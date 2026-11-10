import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { focusCanvas } from '@/app/keys.ts'
import { Rise } from '@/app/Reveal.tsx'
import { useStops } from '@/app/stops.ts'
import { useView } from '@/app/view-store.ts'
import { Button } from '@/components/ui/button.tsx'
import { useQuestions } from '@/features/questions/store.ts'
import { rowVariants, useArriving, type Leaving } from '@/features/reports/list-motion.ts'
import { useStill } from '@/features/reports/still.ts'
import { ItemCard } from './ItemCard.tsx'
import { stepInRow, type WaitingRow } from './items.ts'
import { PileTile } from './Pile.tsx'
import { sampleReviewFor } from './sample.ts'
import { useActionItems, useWaitingRows } from './store.ts'

/** The question on the sheet that this screen raised, and from where, so the keyboard comes back to the right place. */
interface Asking {
  id: string
  from: 'row' | 'sample'
}

/**
 * Action Items: everything waiting on the user, the one that has waited longest first. A row opens the way a
 * question does, on the question sheet, and what comes of it shows here: an answer takes the row away, a
 * question put off arrives as a row. A finished branch can also be opened in Change Review.
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
  const [leaving, setLeaving] = useState<Leaving>('filtered')
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

  // The sheet asks. Once the question leaves it, the keyboard comes back here: to the row that takes the
  // answered one's place, or to the row that was put off.
  useEffect(
    () =>
      useQuestions.subscribe(({ queue }) => {
        const asked = asking.current
        if (!asked || queue.waiting.some((question) => question.id === asked.id)) return
        asking.current = null
        if (!queue.answered.some((entry) => entry.id === asked.id)) return focusLater(asked.id)
        setLeaving('answered')
        if (asked.from === 'sample') {
          requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[data-sample-question]')?.focus())
          return
        }
        const list = shown.current
        const at = list.findIndex((row) => row.id === asked.id)
        focusLater((list[at + 1] ?? list[at - 1])?.id ?? null)
      }),
    [],
  )

  // The frame may hand the keyboard over before this screen has loaded. Then it is already waiting here.
  useEffect(() => {
    const screen = root.current?.closest<HTMLElement>('[data-canvas-screen]')
    if (screen && document.activeElement === screen) root.current?.querySelector<HTMLElement>('[data-stop]')?.focus()
  }, [])

  const ask = (row: WaitingRow) => {
    if (!useActionItems.getState().sample) return
    asking.current = { id: row.id, from: 'row' }
    useQuestions.getState().raise(row.question)
  }

  const askSample = () => {
    if (!useActionItems.getState().sample) return
    const before = new Set(useQuestions.getState().queue.waiting.map(({ id }) => id))
    useQuestions.getState().raiseSample()
    const raised = useQuestions.getState().queue.waiting.find(({ id }) => !before.has(id))
    asking.current = raised ? { id: raised.id, from: 'sample' } : null
  }

  const review = (row: WaitingRow) => {
    if (!useActionItems.getState().sample || !row.item) return
    useView.getState().openReviewFor(sampleReviewFor(row.item))
    // The keyboard goes along into the review.
    requestAnimationFrame(focusCanvas)
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
    <motion.div ref={root} layoutScroll className="scroll-quiet h-full overflow-y-auto px-6 pt-[78px] pb-10" onKeyDownCapture={onKeyDownCapture}>
      <div className="mx-auto flex max-w-[760px] flex-col gap-3">
        <PileTile rows={rows} now={now} />

        <ul className="relative flex flex-col gap-2" aria-label="Waiting on you">
          <AnimatePresence mode="popLayout" custom={leaving}>
            {rows.map((row) => (
              <ItemCard key={row.id} row={row} now={now} variants={variants} order={arriving ? order++ : -1} readOnly={!sample} onAsk={ask} onReview={review} />
            ))}
          </AnimatePresence>
        </ul>

        <Rise className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 pt-1">
          <p className="text-[12px] text-muted-foreground">
            {sample ? "Sample data. hobkin's own items show here once the host is connected." : 'Host action items are read-only here. Answering and Change Review are not connected yet.'}
          </p>
          {sample ? (
            <Button variant="ghost" size="sm" data-stop="" data-sample-question="" onClick={askSample}>
              Ask a sample question
            </Button>
          ) : null}
        </Rise>
      </div>
    </motion.div>
  )
}
