import { AnimatePresence, motion, type Variants } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Hero, Rise } from '@/app/Reveal.tsx'
import { SCREEN_COLUMN, SCREEN_PANES, SCREEN_SCROLLER } from '@/app/screen-layout.ts'
import { useStops } from '@/app/stops.ts'
import { slideVariants } from '@/features/reports/slide.ts'
import { useStill } from '@/features/reports/still.ts'
import { spring, stagger, tween } from '@/lib/motion.ts'
import { askForNewRoutine } from './ask.ts'
import { reveal, slideTo } from './aside.ts'
import { Detail } from './Detail.tsx'
import { BrokenFiles, EmptyHome, SampleLine, SkyTile, Suggested, Templates } from './Extras.tsx'
import { useClock } from './hooks.ts'
import { AllRoutines, NextSevenDays, RoutineIndex } from './Lists.tsx'
import { selectPreparedView } from './prepare.ts'
import { listOrder, slideBetween } from './rules.ts'
import { useRoutines, VIEW_ZONE, type RoutinesView } from './store.ts'
import { Workflows } from './Workflows.tsx'
import './routines.css'

/**
 * Routines, as time. The sky across the top shows the day rolling past (or the week ahead) with every
 * routine on the sun's path. Under it, the same routines as a list: grouped by how often they run, or the
 * next seven days in time order. A routine opens as Reports opens a report: the screen slides aside, and the
 * routine's card comes in with every routine listed beside it. Another routine from that list slides in the same way.
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
  const home = useRef<HTMLDivElement | null>(null)
  useStops(root)
  const now = useClock(30_000)
  const { data, prepared, sample, view, openId, lit, pending, refused } = useRoutines(
    useShallow((state) => ({
      data: state.data,
      prepared: state.prepared,
      sample: state.sample,
      view: state.view,
      openId: state.openId,
      lit: state.lit,
      pending: state.pending,
      refused: state.refused,
    })),
  )
  const actions = useRoutines(
    useShallow((state) => ({
      setView: state.setView,
      setSkyWidth: state.setSkyWidth,
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
  // Which way the routine's card last slid, as in Reports: 1 in from the right, -1 from the left, 0 not yet, so a
  // card already open when the screen arrives comes with it. `aside` is the same for the whole open layer.
  const [step, setStep] = useState<0 | 1 | -1>(0)
  const [aside, setAside] = useState<0 | 1 | -1>(0)
  const still = useStill()
  const slides = useMemo(() => slideVariants(still), [still])
  const [asked, setAsked] = useState(0)
  const screen = selectPreparedView(prepared, view)
  const { facts, holds } = screen
  const order = useMemo(() => listOrder(facts), [facts])

  // hobkin's own routines come with their schedules only. The sample also has their runs, memory and reports. Both have
  // the asks that put a message to hobkin in the input: a first or a new routine, a template, a fix for a broken file.
  const fromHost = sample === null
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

  const openRoutine = (id: string, from: string) => {
    setAside(1)
    setStep(0)
    actions.open(id, from)
  }
  // From the list beside an open card: the new card slides in from the side its routine lies on.
  const switchTo = (id: string) => {
    if (!openId || id === openId) return
    setStep(slideBetween(order, openId, id) || 1)
    const entry = screen.days.flatMap((day) => day.entries).find((item) => item.routineId === id)
    actions.open(id, view === 'week' && entry ? `entry-${entry.key}` : `routine-${id}`)
  }
  const closeRoutine = () => {
    const from = useRoutines.getState().openFrom
    setAside(-1)
    actions.close()
    // The keyboard goes back to the row the detail came from, so Up and Down go on from there.
    requestAnimationFrame(() => {
      const row = root.current?.querySelector<HTMLElement>(`[data-anchor="${from}"]`)
      reveal(home.current, row)
      row?.focus({ preventScroll: true })
    })
  }
  const pick = (routineId: string, markKey: string) => openRoutine(routineId, sourceOf(view, routineId, markKey))

  const listProps = {
    facts,
    now,
    zone: VIEW_ZONE,
    walkable,
    pending,
    refused,
    onOpen: openRoutine,
    onRun: actions.runNow,
    onEnable: actions.setEnabled,
    onLight: actions.light,
  }

  return (
    <div ref={root} className="relative h-full" onKeyDown={pressOnEnter}>
      <motion.div ref={home} layoutScroll variants={pieces} inert={!walkable} className={`${SCREEN_SCROLLER} pb-6`}>
        {/* The screen slides aside while a routine is open, as the week does in Reports, and stays as it was. It spans
            the canvas, centered by its padding, so sliding its own width takes all of it out of view. */}
        <motion.div className={`flex flex-col gap-3 ${SCREEN_COLUMN}`} initial={false} animate={slideTo(opened ? slides.exit : slides.center, 1)}>
          <Hero>
            <SkyTile
              facts={facts}
              view={view}
              onView={chooseView}
              walkable={walkable}
              empty={empty}
              onNewRoutine={() => {
                askForNewRoutine()
                onAsked()
              }}
              span={screen.span}
              detail={view === 'all'}
              labels={view === 'all' ? 'hours' : 'days'}
              now={now}
              zone={VIEW_ZONE}
              data={data}
              holds={holds}
              lit={lit}
              marks={screen.marks}
              scene={screen.scene}
              onWidth={actions.setSkyWidth}
              onLight={actions.light}
              onPick={pick}
            />
          </Hero>

          {empty ? null : <Suggested shown={asked > 0} />}

          {data.errors.length ? (
            <Rise>
              <BrokenFiles errors={data.errors} walkable={walkable} onAsked={onAsked} />
            </Rise>
          ) : null}

          {empty ? (
            <Rise>
              <EmptyHome walkable={walkable} onAsked={onAsked} asked={asked > 0} />
            </Rise>
          ) : (
            <Rise>
              <div className="relative">
                <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                  <motion.div key={view} custom={direction} variants={slide} initial="from" animate="here" exit="gone" className="flex flex-col gap-2">
                    {view === 'all' ? <AllRoutines marks={screen.marks} openId={openId} {...listProps} /> : <NextSevenDays days={screen.days} {...listProps} />}
                  </motion.div>
                </AnimatePresence>
              </div>
            </Rise>
          )}

          <Workflows walkable={walkable} now={now} />

          {empty || view === 'all' ? (
            <Rise>
              <Templates templates={data.templates} walkable={walkable} onAsked={onAsked} />
            </Rise>
          ) : null}

          {sample !== null ? (
            <Rise>
              <SampleLine sample={sample} walkable={walkable} onToggle={() => actions.showSample(sample === 'full' ? 'empty' : 'full')} />
            </Rise>
          ) : null}
        </motion.div>
      </motion.div>

      {/* An open routine: its card on the left and every routine on the right, laid out as Reports is. */}
      <AnimatePresence custom={aside}>
        {opened ? (
          <motion.div
            key="open"
            custom={aside}
            variants={slides}
            initial="enter"
            animate="center"
            exit="exit"
            className={`absolute inset-0 ${SCREEN_PANES}`}
          >
            <div className="relative min-h-0 overflow-hidden rounded-[28px]">
              <AnimatePresence initial={false} custom={step}>
                <motion.div key={opened.routine.id} custom={step} variants={slides} initial="enter" animate="center" exit="exit" className="absolute inset-0">
                  <Detail
                    facts={opened}
                    data={data}
                    now={now}
                    zone={VIEW_ZONE}
                    schedulesOnly={fromHost}
                    pending={pending[opened.routine.id]}
                    refused={refused[opened.routine.id]}
                    onClose={closeRoutine}
                    onRun={actions.runNow}
                    onEnable={actions.setEnabled}
                    onChangeTimes={actions.changeTimes}
                  />
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="flex min-h-0 flex-col @max-[800px]:hidden" onKeyDown={(event) => { if (event.key !== 'Escape') return; event.preventDefault(); closeRoutine() }}>
              <RoutineIndex order={order} openId={opened.routine.id} onOpen={switchTo} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
