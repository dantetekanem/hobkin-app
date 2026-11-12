import { ReactFlowProvider } from '@xyflow/react'
import { MotionConfig, useMotionValueEvent } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { ReviewNotes } from '#shared/review/status.ts'
import type { Review, ReviewSource } from '#shared/review/types.ts'
import type { Verdict } from '#shared/review/verdict.ts'
import { hostStore, runCommand, useHost } from '@/lib/host/index.ts'
import { createReviewLoader, type ReviewLoader } from './loader.ts'
import { Preparing } from './Preparing.tsx'
import { RunCard } from './preparing/RunCard.tsx'
import { sampleLanding } from './preparing/sample-landing.ts'
import { sampleHost } from './preparing/sample-run.ts'
import { ReviewLoad } from './ReviewLoad.ts'
import { isSamplePull } from './sample/pull-id.ts'
import { escapeReview, reviewTakesEscape } from './entry.ts'
import { handOffCanvasFocus } from '@/app/focus.ts'
import { Hero, Rise } from '@/app/Reveal.tsx'
import { useView } from '@/app/view-store.ts'
import { Hob } from '@/avatar/Hob.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Dock } from './Chrome.tsx'
import { clampShare, CodePanel, PANEL_SHARE, panelKey } from './code/CodePanel.tsx'
import { DevTools } from './dev/DevTools.tsx'
import { useDev } from './dev/dev.ts'
import { EntranceContext } from './graph/entrance.tsx'
import { planEntrance, type EntrancePlan } from './graph/entrance-plan.ts'
import { Finder } from './graph/Finder.tsx'
import { Graph } from './graph/Graph.tsx'
import { WireCard } from './graph/WireCard.tsx'
import { pressKey } from './keys.ts'
import type { AskCommand } from './panel/ask.ts'
import { celebrate } from './panel/Celebration.tsx'
import { STEPS_STRIP, StepsPanel, stepsPanelWidth, type PanelChrome } from './panel/StepsPanel.tsx'
import { Shortcuts } from './Shortcuts.tsx'
import './review.css'
import { sampleSource, SAMPLE_REVIEWS } from './source.ts'
import { reviewMemory, StageProvider, useReduced, useReviewMemory } from './state/context.tsx'
import { memoryKey } from './state/memory.ts'
import { followCursor, shownPlaces } from './state/cursor.ts'
import { createSession } from './state/session.ts'
import type { Size } from './story/camera.ts'
import { StoryLayer } from './story/StoryLayer.tsx'
import { useCamera } from './story/useCamera.ts'
import { afterVerdict, verdictKind, type VerdictCommands } from './verdict.ts'

/**
 * What floats over the canvas, which the focus is never framed under: the frame's two menus at the top
 * (the main one, and under it the pill of the screen that is open for now), and the rail at the bottom.
 */
const COVER = { top: 112, bottom: 68 }
/** Below this zoom a card shows only its name, large. */
const FAR = 0.6
/** The keys that keep the reviewer talking to hobkin: the box, notes and the verdict all live in the panel. */
const TALK_KEYS = new Set(['h', 'n', 'c', 'd', 'a', 'm', 'x'])

/** The places hobkin pointed to (`review.show`) that this window has shown, so each is shown once. */
const shown = shownPlaces(storageOrNull())
function storageOrNull(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Runs host commands, and refuses once another host has taken the place of the one `home` names. */
function commandsOnHost(home: string | null | undefined): typeof runCommand {
  return (name, ...args) => {
    if (hostStore.getState().home !== home) return Promise.reject(new Error('The connected host changed. Reopen this review.'))
    return runCommand(name, ...args)
  }
}

/**
 * A hot update that runs this file again, as one to the session's code does, starts the stage again, so an open review
 * never holds a session made by code that is gone. Each run of the file has its own mark; a built app has none.
 */
const CODE = import.meta.hot ? Math.random().toString(36).slice(2, 8) : ''

/**
 * Change Review's canvas screen. This file is the entry the frame mounts.
 * Specs: 005-review-model, 006-review-graph, 007-review-story, 008-review-code, 032-change-review.
 */
export function ReviewScreen() {
  const reviewId = useView((view) => view.openReview)
  const closeReview = useView((view) => view.closeReview)
  const home = useHost((state) => state.home)
  const live = Boolean(home) && !SAMPLE_REVIEWS.includes(reviewId ?? 'sample')
  const loader = useMemo(() => {
    const id = reviewId ?? 'sample'
    const scope = live ? `host:${home}` : 'sample'
    // With no host, a sample pull request is prepared by a made-up host, so its preparation and rebuilds can be seen,
    // and the sample finished change lands through one, so its refresh and its merge can be seen. Their notes stay the
    // window's own. A live review's commands are only ever the connected host's.
    const windowNotes = (review: Review): ReviewNotes => {
      const saved = reviewMemory.getState().of({ ...review, memoryScope: scope } as Review)
      return { entries: saved.notes, draft: saved.draft }
    }
    const landing = sampleLanding(id, live, sampleSource, windowNotes)
    const source = live ? { command: commandsOnHost(home) } : isSamplePull(id) ? { command: sampleHost(id, sampleSource, windowNotes) } : landing ? { command: landing } : { sample: sampleSource }
    return createReviewLoader({ id, scope, memory: reviewMemory, ...source })
  }, [reviewId, home, live])

  useEffect(() => {
    void loader.load()
    // While it is being prepared it is loaded again. Once open, the host is asked how it stands: whether the change
    // moved on, where hobkin moved the view, and whether hobkin left notes. A pull request waiting for "Start AI
    // review" is left alone.
    const timer = setInterval(() => void loader.tick(), 1000)
    return () => { clearInterval(timer); loader.dispose() }
  }, [loader])

  // The verdict and the messages to hobkin go to the same host the review came from, and nowhere once another host has
  // taken its place. The sample finished change's verdict goes to its made-up host, so it can be seen to land.
  const verdict = useMemo<VerdictCommands | null>(() => (live ? commandsOnHost(home) : sampleLanding(reviewId ?? 'sample', live, sampleSource)), [home, live, reviewId])
  const ask = useMemo<AskCommand | null>(() => (live ? commandsOnHost(home) : null), [home, live])

  return <ReviewLoad loader={loader} renderReview={(review) => (
    <ReactFlowProvider key={`${memoryKey(review)}:${loader.getState().preparation?.preparedAt ?? ''}:${loader.getState().assessment?.head ?? ''}@${loader.getState().assessment?.summary.at ?? ''}${CODE}`}>
      <Stage review={review} source={loader.source} loader={loader} live={live} close={closeReview} verdict={verdict} ask={ask} />
    </ReactFlowProvider>
  )} renderWaiting={(status, reason) => status === 'preparing' || status === 'awaiting'
    ? <Preparing loader={loader} closeReview={closeReview} />
    : <ReviewWaiting status={status} reason={reason} closeReview={closeReview} />} renderRun={() => <RunCard loader={loader} />} />
}

function ReviewWaiting({ status, reason, closeReview }: { status: string; reason: string | null; closeReview: () => void }) {
  const failed = status === 'refused' || status === 'error'
  return (
    <div className="grid h-full place-items-center p-8 pt-20">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <Hero>
          <Hob mood={failed ? 'confused' : 'searching'} size={112} stage="var(--card)" />
        </Hero>
        <Rise>
          <p className="font-heading text-[20px] font-semibold tracking-[-0.02em]">{failed ? 'This review cannot be shown' : 'Opening the review'}</p>
        </Rise>
        {failed ? (
          <>
            <Rise>
              <p className="text-[15px] text-pretty text-muted-foreground">{reason}</p>
            </Rise>
            <Rise>
              <Button variant="outline" onClick={closeReview}>
                Close
              </Button>
            </Rise>
          </>
        ) : null}
      </div>
    </div>
  )
}

function Stage({ review, source, loader, live, close, verdict, ask }: {
  review: Review
  source: ReviewSource
  loader: ReviewLoader
  live: boolean
  close: () => void
  verdict: VerdictCommands | null
  ask: AskCommand | null
}) {
  const root = useRef<HTMLDivElement>(null)
  const [shortcuts, setShortcuts] = useState(false)
  const preparation = useStore(loader, (state) => state.preparation)
  const assessment = useStore(loader, (state) => state.assessment)

  // Once a verdict has landed the review closes: a merged change with "Merged!", any other with a short confirmation. A
  // change an agent brings up to date first keeps it open until it has merged. A verdict that lands after the reviewer
  // has left this review closes nothing that is open now, and a merge after they left shows nothing.
  const here = useRef(true)
  useEffect(() => {
    here.current = true
    return () => {
      here.current = false
    }
  }, [])
  const landed = useMemo(
    () => (done: Verdict, message: string) =>
      afterVerdict(done, message, {
        kind: verdictKind(review.id),
        here: () => here.current,
        close: () => here.current && close(),
        celebrate: (kind, words) => celebrate({ kind, message: words }),
        landing: loader.look,
        follow: loader.follow,
      }),
    [close, loader, review.id],
  )
  const chrome = useMemo<PanelChrome>(
    () => ({ live, preparation, assessment, rebuild: () => void loader.refresh(), close, verdict, saveNotes: loader.saveNotes, ask, landed }),
    [live, preparation, assessment, loader, close, verdict, ask, landed],
  )
  const graph = useRef<HTMLDivElement>(null)
  const camera = useCamera()
  const reduced = useReduced()
  const treatment = useDev((dev) => dev.treatment)
  const [session] = useState(() => createSession(review, reviewMemory))
  useEffect(() => session.connect(), [session])
  // hobkin moves the reviewer's view through the host, to a step or a node. A place it pointed to before the review was
  // opened is shown too: a review opened from Work, Home, a report or the chat lands where hobkin said. Each place once.
  const cursor = preparation?.cursor
  const place = `${(review as Review & { memoryScope?: string }).memoryScope ?? ''}:${review.id}`
  useEffect(() => void followCursor(session, shown, place, cursor), [cursor, place, session])

  const [canvas, setCanvas] = useState<Size>({ width: 0, height: 0 })
  const [windowHeight, setWindowHeight] = useState(() => innerHeight)
  const codeOpen = useStore(session, (state) => state.code != null)
  const stepsOpen = useStore(session, (state) => state.panelOpen)
  const share = useReviewMemory((memory) => memory.panelShare) ?? PANEL_SHARE.initial
  // The panel takes a share of the window's height, 30% until the reviewer drags it.
  const panelHeight = codeOpen ? Math.round(clampShare(share) * windowHeight) : 0

  // The frame grows and shrinks the canvas on a spring, so the size is watched, never assumed.
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const measure = () => {
      // offsetWidth, not the bounding box: the screen arrives scaled, and the layout size is the true one.
      const size = { width: element.offsetWidth, height: element.offsetHeight }
      camera.setCanvas(size, COVER)
      setCanvas((before) => (before.width === size.width && before.height === size.height ? before : size))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    const onResize = () => setWindowHeight(innerHeight)
    addEventListener('resize', onResize)
    return () => {
      observer.disconnect()
      removeEventListener('resize', onResize)
    }
  }, [camera])

  // The entrance plays the first time a review is opened. After that its nodes are simply there.
  const [entrance, setEntrance] = useState<EntrancePlan | null>(() => {
    if (reduced || reviewMemory.getState().of(review).opened) return null
    const view = session.getState().view
    return planEntrance(view.nodes, view.edges)
  })
  useEffect(() => {
    if (!entrance) return
    reviewMemory.getState().markOpened(review)
    const done = setTimeout(() => setEntrance(null), (entrance.total + 0.8) * 1000)
    return () => clearTimeout(done)
  }, [entrance, review])

  // From far away the cards show only their names. Set on the root, so no card draws again for it.
  useMotionValueEvent(camera.viewport, 'change', (viewport) => {
    const far = String(viewport.zoom < FAR)
    if (root.current && root.current.dataset.far !== far) root.current.dataset.far = far
  })

  // With reduced motion a step is a cut with a short fade.
  const moveKey = useStore(session, (state) => state.move.key)
  useEffect(() => {
    const element = graph.current
    if (!reduced || !element || moveKey === 0) return
    element.classList.remove('rv-cut')
    void element.offsetWidth
    element.classList.add('rv-cut')
  }, [moveKey, reduced])

  // The frame hands the keyboard to the screen's section. The review takes it from there, so its keys work.
  useEffect(() => {
    const element = root.current
    if (!element) return
    const releaseFocus = handOffCanvasFocus(element)

    const onKeyDown = (event: KeyboardEvent) => {
      // ⌘? shows every key of the review, and hides them again.
      if (!event.defaultPrevented && event.metaKey && !event.ctrlKey && (event.key === '?' || (event.shiftKey && event.key === '/'))) {
        setShortcuts((open) => !open)
        event.preventDefault()
        return
      }
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.isComposing) return
      const target = event.target as HTMLElement
      if (event.key === 'Escape') {
        // A field leaves itself and keeps its words (the note editor, the finder, the box to ask hobkin), and a dialog,
        // a menu or a list closes itself. Neither ever closes the review.
        if (!reviewTakesEscape(target)) return
        let left = false
        escapeReview(session.getState(), () => { left = true; useView.getState().closeReview() })
        // Whatever closed may have held the keyboard, such as the code panel. It stays in the review.
        if (!left && !element.contains(document.activeElement)) element.focus({ preventScroll: true })
        event.preventDefault()
        return
      }
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return
      // A focused button is pressed by Enter and Space, as buttons are.
      if ((event.key === 'Enter' || event.key === ' ') && target.closest('button, a, [role="button"]')) return
      // Inside the code, Up and Down scroll it.
      if (target.closest('[data-rv-code]') && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key) && !event.shiftKey) return
      const steps = element.querySelector<HTMLElement>('[data-rv-steps]')
      const inSteps = steps?.contains(target) ?? false
      // Inside the panel, Up and Down are its own.
      if (inSteps && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey) return
      const used = pressKey(session.getState(), { key: event.key, shift: event.shiftKey, alt: event.altKey }, {
        panelKey,
        // S hides the panel, or brings it back. The panel does it, and keeps the keyboard where it belongs.
        toggleSteps: () => steps?.dispatchEvent(new Event('rv-toggle')),
        talk: () => steps?.dispatchEvent(new Event('rv-talk')),
        verdict: (kind: Verdict) => {
          // A key held down only repeats: it never gives the second click that confirms.
          if (event.repeat) return
          // The key is the click on its choice: the first shows what it will do, and a second press within ten seconds
          // does it. The keyboard goes with it, which opens the panel.
          const choice = steps?.querySelector<HTMLElement>(`[data-verdict="${kind}"]:not([disabled])`)
          choice?.focus({ preventScroll: true })
          choice?.click()
        },
      })
      if (!used) return
      event.preventDefault()
      // Walking the graph again is going back to it from the conversation, which lets the panel tuck away.
      if (!TALK_KEYS.has(event.key.toLowerCase())) session.getState().setTalking(false)
    }
    // A click on the graph is going back to it too. One in the panel or the code panel is not.
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('[data-rv-steps], [data-rv-panel]')) session.getState().setTalking(false)
    }
    element.addEventListener('keydown', onKeyDown)
    element.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      releaseFocus()
      element.removeEventListener('keydown', onKeyDown)
      element.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [session])

  const stage = useMemo(() => ({ session, source, camera }), [camera, session, source])

  return (
    <StageProvider value={stage}>
      <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
        <EntranceContext.Provider value={entrance}>
          <div ref={root} tabIndex={-1} className="rv" data-reduced={reduced} data-treatment={treatment} data-far="false" data-rv-root>
            <div ref={graph} className="absolute inset-0">
              <Graph />
            </div>
            <StoryLayer canvas={canvas} panelHeight={panelHeight} units={assessment?.units?.units} ask={ask} />
            <WireCard />
            <Finder />
            <Dock room={canvas.width - (stepsOpen ? stepsPanelWidth(canvas.width) : STEPS_STRIP)} />
            <StepsPanel canvas={canvas} chrome={chrome} />
            <CodePanel height={panelHeight} windowHeight={windowHeight} units={assessment?.units?.units} ask={ask} />
            {shortcuts ? (
              <Shortcuts
                onClose={() => {
                  setShortcuts(false)
                  root.current?.focus({ preventScroll: true })
                }}
              />
            ) : null}
            {import.meta.env.DEV ? <DevTools onReplay={() => setEntrance(planEntrance(session.getState().view.nodes, session.getState().view.edges))} /> : null}
          </div>
        </EntranceContext.Provider>
      </MotionConfig>
    </StageProvider>
  )
}
