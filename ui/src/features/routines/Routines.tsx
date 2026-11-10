import { AnimatePresence, motion, type Variants } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Hero, Rise } from '@/app/Reveal.tsx'
import { useStops } from '@/app/stops.ts'
import { spring, stagger, tween } from '@/lib/motion.ts'
import { askForNewRoutine } from './ask.ts'
import { Detail } from './Detail.tsx'
import { BrokenFiles, EmptyHome, SampleLine, SkyTile, Suggested, Templates } from './Extras.tsx'
import { useClock } from './hooks.ts'
import { AllRoutines, NextSevenDays } from './Lists.tsx'
import { factsOf } from './rules.ts'
import { rollingSpan, spanOf } from './sky-math.ts'
import { useRoutines, VIEW_ZONE, type RoutinesView } from './store.ts'
import { nextSevenDays } from './timeline.ts'
import './routines.css'

/**
 * Routines, as time. The sky across the top shows the day rolling past (or the week ahead) with every
 * routine on the sun's path. Under it, the same routines as a list: grouped by how often they run, or the
 * next seven days in time order. A routine opens into its detail, which grows out of the row that was chosen.
 *
 * Keys: Up and Down walk the screen. Left and Right change the view, or move between templates. Enter or
 * Right opens a routine. In its detail, Escape or Left goes back. Tab is the frame's, as everywhere.
 * Spec: 010-routines.
 */

/** The screen's pieces land one after another as it arrives, the sky first. */
const pieces: Variants = {
  enter: {},
  center: { transition: { staggerChildren: stagger } },
  exit: {},
}

/** Changing the view slides the old list out one way and the new one in from the other. */
const slide: Variants = {
  from: (direction: number) => ({ opacity: 0, transform: `translateX(${direction * 64}px)` }),
  here: { opacity: 1, transform: 'translateX(0px)', transition: { transform: spring.screen, opacity: tween.enter, staggerChildren: stagger / 2 } },
  gone: (direction: number) => ({ opacity: 0, transform: `translateX(${direction * -40}px)`, transition: { transform: spring.screenExit, opacity: tween.exit } }),
}

/** The day in the sky rolls with the clock: these hours behind now, and these ahead. */
const HOURS_BEHIND = 8
const HOURS_AHEAD = 16
/** How long the word that a message went to hobkin stays, in seconds. Long enough to read it. */
const SUGGESTED_FOR = 3.6

/**
 * Enter presses the button that has the keyboard, here in one place, so it does so the same way for every
 * button on the screen, including a key that hobkin or a test sends.
 */
function pressOnEnter(event: KeyboardEvent<HTMLDivElement>) {
  const target = event.target
  if (event.key !== 'Enter' || event.isDefaultPrevented()) return
  if (!(target instanceof HTMLButtonElement)) return
  if (target.disabled || target.getAttribute('aria-disabled') === 'true') return

  event.preventDefault()
  target.click()
}

/**
 * The element a routine's detail grows out of when one of its times is picked in the sky: its row in the
 * list of all routines, or in the week the line with the same time, which shares the mark's key.
 */
function sourceOf(view: RoutinesView, routineId: string, markKey: string): string {
  return view === 'all' ? `routine-${routineId}` : `entry-${markKey}`
}

export function Routines() {
  const root = useRef<HTMLDivElement | null>(null)
  useStops(root)
  const now = useClock(30_000)
  const { data, sample, view, openId, openFrom, lit } = useRoutines(
    useShallow((state) => ({
      data: state.data,
      sample: state.sample,
      view: state.view,
      openId: state.openId,
      openFrom: state.openFrom,
      lit: state.lit,
    })),
  )
  const actions = useRoutines(
    useShallow((state) => ({
      setView: state.setView,
      open: state.open,
      close: state.close,
      light: state.light,
      runNow: state.runNow,
      setEnabled: state.setEnabled,
      changeTimes: state.changeTimes,
      showSample: state.showSample,
    })),
  )
  const [direction, setDirection] = useState<1 | -1>(1)
  const [asked, setAsked] = useState(0)

  const facts = useMemo(() => factsOf(data, now), [data, now])
  const holds = useMemo(() => Object.fromEntries(facts.map((item) => [item.routine.id, item.hold])), [facts])
  const span = useMemo(() => {
    if (view === 'all') return rollingSpan(now, VIEW_ZONE, HOURS_BEHIND, HOURS_AHEAD)
    return spanOf(now, VIEW_ZONE, 7)
  }, [view, now])
  const days = useMemo(() => view === 'week' ? nextSevenDays(data.routines, now, VIEW_ZONE, holds) : [], [view, data.routines, now, holds])

  const readOnly = sample === null
  const opened = facts.find((item) => item.routine.id === openId)
  const walkable = opened === undefined
  const empty = data.routines.length === 0 && data.errors.length === 0

  // The word that a message went to hobkin stays for a moment.
  useEffect(() => {
    if (!asked) return
    const timer = setTimeout(() => setAsked(0), SUGGESTED_FOR * 1000)
    return () => clearTimeout(timer)
  }, [asked])
  const onAsked = () => setAsked((count) => count + 1)

  const chooseView = (next: RoutinesView) => {
    if (next === view) return
    setDirection(next === 'week' ? 1 : -1)
    actions.setView(next)
  }

  const closeRoutine = () => {
    const from = useRoutines.getState().openFrom
    actions.close()
    // The keyboard goes back to the row the detail came from, so Up and Down go on from there.
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-anchor="${from}"]`)?.focus({ preventScroll: true }))
  }
  const pick = (routineId: string, markKey: string) => actions.open(routineId, sourceOf(view, routineId, markKey))

  const listProps = {
    facts,
    now,
    zone: VIEW_ZONE,
    walkable,
    openFrom,
    readOnly,
    onOpen: actions.open,
    onRun: actions.runNow,
    onEnable: actions.setEnabled,
    onLight: actions.light,
  }

  return (
    <div ref={root} className="relative h-full" onKeyDown={pressOnEnter}>
      <motion.div layoutScroll variants={pieces} inert={!walkable} className="scroll-quiet h-full overflow-y-auto px-6 pt-[78px] pb-6">
        <div className="mx-auto flex max-w-[1040px] flex-col gap-3">
          <Hero>
            <SkyTile
              facts={facts}
              view={view}
              onView={chooseView}
              walkable={walkable}
              empty={empty}
              readOnly={readOnly}
              onNewRoutine={() => {
                askForNewRoutine()
                onAsked()
              }}
              span={span}
              detail={view === 'all'}
              labels={view === 'all' ? 'hours' : 'days'}
              now={now}
              zone={VIEW_ZONE}
              data={data}
              holds={holds}
              lit={lit}
              onLight={actions.light}
              onPick={pick}
            />
          </Hero>

          {readOnly ? (
            <p className="px-1 text-[12.5px] text-muted-foreground">
              From your hobkin. Controls are read-only here; manage routines in hobkin. The sky and week show schedule times, not run receipts.
            </p>
          ) : empty ? null : <Suggested shown={asked > 0} />}

          {data.errors.length ? (
            <Rise>
              {readOnly ? data.errors.map((error, index) => (
                <p key={`${error.path}-${index}`} className="text-[13px] text-warn-fg">{error.path}: {error.message}</p>
              )) : <BrokenFiles errors={data.errors} walkable={walkable} onAsked={onAsked} />}
            </Rise>
          ) : null}

          {empty ? (
            <Rise>
              {readOnly ? <p className="text-[14px] text-muted-foreground">No routines in the current host snapshot.</p> : <EmptyHome walkable={walkable} onAsked={onAsked} asked={asked > 0} />}
            </Rise>
          ) : (
            <Rise>
              <div className="relative">
                <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                  <motion.div key={view} custom={direction} variants={slide} initial="from" animate="here" exit="gone" className="flex flex-col gap-2">
                    {view === 'all' ? <AllRoutines {...listProps} /> : <NextSevenDays days={days} {...listProps} />}
                  </motion.div>
                </AnimatePresence>
              </div>
            </Rise>
          )}

          {!readOnly && !empty && view === 'all' ? (
            <Rise>
              <Templates templates={data.templates} walkable={walkable} onAsked={onAsked} />
            </Rise>
          ) : null}

          {sample !== null ? (
            <Rise>
              <SampleLine sample={sample} walkable={walkable} onToggle={() => actions.showSample(sample === 'full' ? 'empty' : 'full')} />
            </Rise>
          ) : null}
        </div>
      </motion.div>

      <AnimatePresence>
        {opened && openFrom ? (
          <Detail
            key={opened.routine.id}
            facts={opened}
            data={data}
            now={now}
            zone={VIEW_ZONE}
            from={openFrom}
            readOnly={readOnly}
            onClose={closeRoutine}
            onRun={actions.runNow}
            onEnable={actions.setEnabled}
            onChangeTimes={actions.changeTimes}
          />
        ) : null}
      </AnimatePresence>
    </div>
  )
}
