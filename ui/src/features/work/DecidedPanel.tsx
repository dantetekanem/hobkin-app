import { motion } from 'motion/react'
import { memo, useEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { useStill } from '@/app/still.ts'
import { useStops } from '@/app/stops.ts'
import { useView } from '@/app/view-store.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { OpenArrow } from '@/components/ui/open-arrow.tsx'
import type { DecidedChange } from '#shared/protocol/metrics.ts'
import { chartId } from '@/features/numbers/board-model.ts'
import { SERIES_COLOR } from '@/features/numbers/chart-kit.ts'
import { localDay, shortDay } from '@/features/numbers/format.ts'
import { useWorkMetrics } from '@/features/numbers/use-work-metrics.ts'
import { spring, tween } from '@/lib/motion.ts'
import { decidedList, decidedWords } from './numbers-open.ts'
import { sampleDecided } from './sample.ts'
import { useWorkTab, type Listing } from './tab.ts'
import { useWorkView } from './store.ts'

const OUTCOME_COLOR: Record<DecidedChange['outcome'], string> = {
  'merged-by-itself': SERIES_COLOR.itself,
  'merged-by-you': SERIES_COLOR.you,
  declined: SERIES_COLOR.declined,
}

const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

/** When a change was decided: its time today, its day before. */
function whenWords(at: string, today: string): string {
  const day = localDay(Date.parse(at))
  return day === today ? TIME.format(new Date(at)) : shortDay(day)
}

/**
 * The changes behind a chart of the Numbers tab, in a panel over the page (053, "Numbers"): merged and declined, the
 * first passes, or the ones a wait was measured on, on the day or week picked. The page under it waits while it is
 * open, so the keyboard stays in it: Up and Down walk its rows, a row opens its project's page, and Escape closes it,
 * giving the keyboard back to the chart that opened it. Coming back from a project lands on the row it was opened from.
 */
export function DecidedPanel({ listing }: { listing: Listing }) {
  const still = useStill()
  const panel = useRef<HTMLDivElement | null>(null)
  const close = useRef<HTMLButtonElement | null>(null)
  const period = useWorkTab((state) => state.period)
  const { metrics, state } = useWorkMetrics(period)
  const { work } = useWorkView()
  useStops(panel)

  // The numbers' own sample lists nothing, so the sample's changes come from Work's sample.
  const decided = useMemo(() => {
    if (metrics?.decided) return metrics.decided
    return state === 'sample' && metrics ? sampleDecided(metrics) : undefined
  }, [metrics, state])
  const today = metrics?.to ?? localDay(Date.now())
  const list = useMemo(() => decidedList(decided, listing.ask, today, period), [decided, listing.ask, today, period])
  const names = useMemo(() => new Map(work?.projects.map((project) => [project.slug, project.name]) ?? []), [work?.projects])

  // The keyboard arrives on the row last opened, or on Close; and again when the page comes back along the trail.
  useEffect(() => {
    const root = panel.current
    const target = () => {
      const row = listing.item ? root?.querySelector<HTMLElement>(`[data-decided="${CSS.escape(listing.item)}"]`) : null
      return row ?? close.current
    }
    target()?.focus({ preventScroll: true })
    const screen = root?.closest<HTMLElement>('[data-canvas-screen]')
    // Ahead of the page's own arrival, whose rows wait under the panel and cannot take the keyboard.
    const onArrive = (event: FocusEvent) => {
      if (event.target !== screen) return
      event.stopImmediatePropagation()
      target()?.focus({ preventScroll: true })
    }
    screen?.addEventListener('focus', onArrive, true)
    return () => screen?.removeEventListener('focus', onArrive, true)
    // Only as the panel opens: the item it was opened at is read then.
  }, [])

  const shut = () => {
    const chart = listing.ask.chart
    useWorkTab.getState().closeList()
    requestAnimationFrame(() => {
      const opener = document.getElementById(chartId(chart))?.querySelector<HTMLElement>('[data-stop]')
      opener?.focus({ preventScroll: true })
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    shut()
  }

  const count = list.rows.length
  return (
    <>
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 z-10 bg-scrim"
        onClick={shut}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: tween.exit }}
        transition={tween.enter}
      />
      <motion.div
        ref={panel}
        role="region"
        aria-label={`${list.heading}, ${list.range}`}
        onKeyDown={onKeyDown}
        className="scroll-quiet absolute inset-y-0 right-0 z-10 flex w-[min(560px,100%)] flex-col overflow-y-auto bg-background px-5 pt-[78px] pb-10 shadow-float"
        initial={still ? { opacity: 0 } : { x: '100%' }}
        animate={still ? { opacity: 1 } : { x: 0 }}
        exit={still ? { opacity: 0, transition: { duration: 0 } } : { x: '100%' }}
        transition={still ? { duration: 0 } : spring.sheet}
      >
        <header className="flex flex-col gap-1 px-1 pb-3">
          <div className="flex items-center gap-3">
            <p className="eyebrow">Numbers</p>
            <Button ref={close} variant="ghost" size="sm" data-stop="" className="ml-auto text-muted-foreground" onClick={shut}>
              Close <Kbd>esc</Kbd>
            </Button>
          </div>
          <h2 className="font-heading text-[20px] leading-tight font-semibold tracking-[-0.02em]">{list.heading}</h2>
          <p className="text-[13px] text-muted-foreground tabular-nums">
            {list.range.charAt(0).toUpperCase() + list.range.slice(1)}
            {list.listed ? ` · ${count} ${count === 1 ? 'change' : 'changes'}` : ''}. A row opens its project.
          </p>
        </header>
        {!list.listed ? (
          <p className="px-1 text-[13.5px] leading-relaxed text-muted-foreground">
            {state === 'loading' ? 'Reading the numbers…' : 'This host does not list the changes yet. They show once hobkin restarts.'}
          </p>
        ) : count ? (
          <ul className="flex flex-col">
            {list.rows.map((change) => (
              <li key={`${change.slug}:${change.item}:${change.at}`}>
                <DecidedRow change={change} project={names.get(change.slug) ?? change.slug} when={whenWords(change.at, today)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-1 text-[13.5px] text-muted-foreground">Nothing in these days.</p>
        )}
      </motion.div>
    </>
  )
}

const openFrom = (change: DecidedChange) => {
  useWorkTab.getState().listed(change.item)
  useView.getState().openProject(change.slug)
}

/** One change: when, what, where, how it was decided. A press opens its project's page. */
const DecidedRow = memo(function DecidedRow({ change, project, when }: { change: DecidedChange; project: string; when: string }) {
  const words = decidedWords(change)
  return (
    <button
      type="button"
      data-stop=""
      data-decided={change.item}
      aria-label={`${change.title}, ${project}, ${words}, ${when}. Opens ${project}.`}
      onClick={() => openFrom(change)}
      className="pressable flex min-h-14 w-full scroll-mt-[96px] items-center gap-3 rounded-2xl px-3 py-2 text-left outline-offset-[-2px]"
    >
      <span className="w-12 shrink-0 text-[12px] text-muted-foreground tabular-nums">{when}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] leading-snug font-medium">{change.title}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-[2px]" style={{ background: OUTCOME_COLOR[change.outcome] }} />
          <span className="truncate">
            {project} · {words}
            {change.head ? ` · ${change.head}` : ''}
          </span>
        </span>
      </span>
      <OpenArrow />
    </button>
  )
})
