import { ReactFlowProvider } from '@xyflow/react'
import { MotionConfig, useMotionValueEvent } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { Review, ReviewSource } from '#shared/review/types.ts'
import { hostStore, runCommand, useHost } from '@/lib/host/index.ts'
import { createReviewLoader } from './loader.ts'
import { ReviewLoad } from './ReviewLoad.ts'
import { VerdictPanel } from './VerdictPanel.tsx'
import type { VerdictCommands } from './verdict.ts'
import { escapeReview } from './entry.ts'
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
import { STEPS_STRIP, StepsPanel, stepsPanelWidth } from './panel/StepsPanel.tsx'
import './review.css'
import { sampleSource, SAMPLE_REVIEWS } from './source.ts'
import { reviewMemory, StageProvider, useReduced, useReviewMemory } from './state/context.tsx'
import { memoryKey } from './state/memory.ts'
import { createSession } from './state/session.ts'
import type { Size } from './story/camera.ts'
import { StoryLayer } from './story/StoryLayer.tsx'
import { useCamera } from './story/useCamera.ts'

/**
 * What floats over the canvas, which the focus is never framed under: the frame's two menus at the top
 * (the main one, and under it the pill of the screen that is open for now), and the rail at the bottom.
 */
const COVER = { top: 112, bottom: 68 }
/** Below this zoom a card shows only its name, large. */
const FAR = 0.6

/**
 * Change Review's canvas screen. This file is the entry the frame mounts.
 * Specs: 005-review-model, 006-review-graph, 007-review-story, 008-review-code.
 */
export function ReviewScreen() {
  const reviewId = useView((view) => view.openReview)
  const closeReview = useView((view) => view.closeReview)
  const home = useHost((state) => state.home)
  const live = Boolean(home) && !SAMPLE_REVIEWS.includes(reviewId ?? 'sample')
  const verdict = useMemo(() => {
    const current = () => hostStore.getState().home === home && useView.getState().screen === 'review' && useView.getState().openReview === reviewId
    const command: VerdictCommands = (name, args) => {
      if (!home || !current()) return Promise.reject(new Error('The review or connected host changed. Reopen this review.'))
      return runCommand(name, args)
    }
    return { command, current }
  }, [home, reviewId])
  const loader = useMemo(() => createReviewLoader({
    id: reviewId ?? 'sample', scope: live ? `host:${home}` : 'sample', memory: reviewMemory,
    ...(live ? { command: (name, args) => {
      if (hostStore.getState().home !== home) return Promise.reject(new Error('The connected host changed. Reopen this review.'))
      return runCommand(name, args)
    } } : { sample: sampleSource }),
  }), [reviewId, home, live])

  useEffect(() => {
    void loader.load()
    const timer = setInterval(() => {
      const { status, preparation } = loader.getState()
      if (status === 'preparing' || preparation?.phase) void loader.load()
    }, 1500)
    return () => { clearInterval(timer); loader.dispose() }
  }, [loader])

  return <ReviewLoad loader={loader} renderReview={(review) => (
    <ReactFlowProvider key={`${memoryKey(review)}:${loader.getState().preparation?.preparedAt ?? ''}`}>
      <Stage review={review} source={loader.source} />
      <div className="absolute left-4 top-28 z-30"><Button variant="outline" onClick={closeReview}>Close review · Esc</Button></div>
      {live ? <VerdictPanel key={memoryKey(review)} review={review} {...verdict} saveNotes={loader.saveNotes} /> : <div className="absolute right-4 top-28 z-30 flex flex-col items-end gap-1"><Button disabled>Submit review</Button><span className="text-xs text-muted-foreground">Sample only. Nothing is sent.</span></div>}
    </ReactFlowProvider>
  )} renderWaiting={(status, reason) => (
    <ReviewWaiting status={status} reason={reason} closeReview={closeReview} />
  )} />
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
          <p className="font-heading text-[20px] font-semibold tracking-[-0.02em]">{failed ? 'This review cannot be shown' : status === 'preparing' ? 'Preparing the review' : 'Opening the review'}</p>
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

function Stage({ review, source }: { review: Review; source: ReviewSource }) {
  const root = useRef<HTMLDivElement>(null)
  const graph = useRef<HTMLDivElement>(null)
  const camera = useCamera()
  const reduced = useReduced()
  const treatment = useDev((dev) => dev.treatment)
  const [session] = useState(() => createSession(review, reviewMemory))
  useEffect(() => session.connect(), [session])

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
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.isComposing) return
      const target = event.target as HTMLElement
      if (event.key === 'Escape') {
        // Fields in the note editor/finder handle Escape themselves, preserving their draft before leaving.
        if (target.closest('input, textarea') && (session.getState().editor || session.getState().finder)) return
        if (target.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return
        escapeReview(session.getState(), () => useView.getState().closeReview())
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
      // Inside the steps panel, Up and Down walk its controls.
      if (inSteps && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey) return
      const used = pressKey(session.getState(), { key: event.key, shift: event.shiftKey, alt: event.altKey }, {
        panelKey,
        toggleSteps: () => {
          // The 1 key goes to the panel and keeps it open, or comes back from it and lets it tuck away.
          const keep = !reviewMemory.getState().panelPinned
          reviewMemory.getState().setPanelPinned(keep)
          if (keep) requestAnimationFrame(() => steps?.querySelector<HTMLElement>('[aria-current="step"]')?.focus({ preventScroll: true }))
          else element.focus({ preventScroll: true })
        },
        discuss: () => steps?.dispatchEvent(new Event('rv-discuss')),
      })
      if (used) event.preventDefault()
    }
    element.addEventListener('keydown', onKeyDown)
    return () => {
      releaseFocus()
      element.removeEventListener('keydown', onKeyDown)
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
            <StoryLayer canvas={canvas} panelHeight={panelHeight} />
            <WireCard />
            <Finder />
            <Dock room={canvas.width - (stepsOpen ? stepsPanelWidth(canvas.width) : STEPS_STRIP)} />
            <StepsPanel canvas={canvas} />
            <CodePanel height={panelHeight} windowHeight={windowHeight} />
            {import.meta.env.DEV ? <DevTools onReplay={() => setEntrance(planEntrance(session.getState().view.nodes, session.getState().view.edges))} /> : null}
          </div>
        </EntranceContext.Provider>
      </MotionConfig>
    </StageProvider>
  )
}
