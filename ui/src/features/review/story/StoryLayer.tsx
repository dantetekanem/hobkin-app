import { useStore as useFlowStore } from '@xyflow/react'
import { AnimatePresence, motion, useTransform } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Unit } from '#shared/review/assessment.ts'
import { nodeRect, type Rect } from '#shared/review/layout.ts'
import { spring, tween } from '@/lib/motion.ts'
import { drawnTrail, isChangedCode } from '../graph/trail.ts'
import { wireCurve } from '../graph/wire-path.ts'
import { regionsOf } from '../graph/zones.ts'
import { inProofPanel } from '../keys.ts'
import type { AskCommand } from '../panel/ask.ts'
import { OUTLINE_ROOM } from '../outline/Outline.tsx'
import { STEPS_STRIP, stepsPanelWidth } from '../panel/StepsPanel.tsx'
import { useAskHobkin } from '../panel/use-ask.ts'
import { unitInFocus } from '../reading/model.ts'
import { useReduced, useRig, useSession, useSessionStore } from '../state/context.tsx'
import { notesAbout, notesOnStep } from '../state/quick-notes.ts'
import { BesideCard, type BesidePlace } from './Beside.tsx'
import { testCardOf } from './node-tests.ts'
import { cameraFor, composeShot, entryCamera, frameStep, framingOf, overviewCamera, placeCard, revealNode, storyDock, viewportFor, type Camera, type Size } from './camera.ts'
import { NotesBody } from './NotesBody.tsx'
import { StepBody, type CardGraph } from './StepBody.tsx'
import { CardBody, type CardContent } from './StepCard.tsx'
import { offPath } from './story.ts'
import { wireEnds } from './travel.ts'
import { uncoveredMiddle } from './useCamera.ts'
import { ratingGap } from './words.ts'

const notesWidth = (area: Rect) => Math.round(Math.max(240, Math.min(340, area.width - 40)))

/** The camera follows the graph; the step remains in the same corner of the review. */
export function StoryLayer({ canvas, panelHeight, units, ask = null, resume = null }: {
  canvas: Size
  panelHeight: number
  /** The change review's units, when it has rated this change. */
  units?: readonly Unit[]
  /** Sends to hobkin, for a live review. */
  ask?: AskCommand | null
  /** Where the camera was when the reviewer left this review for another page: the first look goes back there (spec 053). */
  resume?: Camera | null
}) {
  const store = useSessionStore()
  const rig = useRig()
  const reduced = useReduced()
  const review = useSession((session) => session.review)
  const view = useSession((session) => session.view)
  const focus = useSession((session) => session.focus)
  const story = useSession((session) => session.story)
  // In Free Roam no step leads, so nothing offers to go back to one.
  const roam = useSession((session) => session.mode === 'roam')
  const move = useSession((session) => session.move)
  const nodeOf = useSession((session) => session.nodeOf)
  const panelOpen = useSession((session) => session.panelOpen)
  const code = useSession((session) => session.code)
  const codeOpen = code != null
  const outline = useSession((session) => session.outline)
  // The steps panel covers the left of the canvas by as much of it as is on screen, and the outline beside it when open.
  const side = (panelOpen ? stepsPanelWidth(canvas.width) : STEPS_STRIP) + (outline ? OUTLINE_ROOM : 0)
  const area = rig.area(panelHeight, side)

  const content = useMemo<CardContent | null>(() => {
    if (story.detour) {
      const node = nodeOf.get(story.detour)
      return node ? { kind: 'node', key: `node:${node.id}`, node, backTo: roam ? null : story.step } : null
    }
    // The whole graph, or a unit's nodes shown from the story: no step is told beside them. "Back to step N" waits below.
    if (story.whole || story.group) return null
    const step = view.story[story.step]
    return step ? { kind: 'step', key: `step:${step.id}`, step, index: story.step, total: view.story.length } : null
  }, [nodeOf, roam, story.detour, story.group, story.step, story.whole, view.story])

  // The unit a step tells, by its own name or by its nodes', and the unit of a node looked at.
  const unit = useMemo(() => {
    if (!content || !units?.length) return undefined
    if (content.kind === 'node') return content.node.unit ? units.find((entry) => entry.id === content.node.unit) : undefined
    const named = content.step.unit ? units.find((entry) => entry.id === content.step.unit) : undefined
    return named ?? unitInFocus(units, content.step.focus.map((id) => nodeOf.get(id)).filter((node) => node != null), null)
  }, [content, nodeOf, units])
  // The card lists the tests of its focus from the review's own wires, without the proposed ones the reviewer removed.
  const graphFacts = useMemo<CardGraph>(() => {
    const removed = new Set(view.removed.map((edge) => edge.id))
    return { covers: view.covers, groups: view.groups, nodeOf, nodes: review.nodes, edges: review.edges.filter((edge) => !removed.has(edge.id)) }
  }, [nodeOf, review.edges, review.nodes, view.covers, view.groups, view.removed])
  // What a step shows is its own: a step told beside its neighbor's node asks about, and opens, none of that node's.
  const own = content?.kind === 'step' ? content.step.focus : focus
  // hobkin is asked about a node of the review: a card of folded tests stands for its first test.
  const about = content?.kind === 'node' ? content.node.id : own[0]
  const askAbout = useAskHobkin(ask, about ? (view.groups[about]?.tests[0] ?? about) : null)
  const actions = useMemo(
    () => ({
      openCode: () => void store.getState().openCode(),
      back: () => store.getState().back(),
      showTest: (id: string) => void store.getState().showTest(id),
      goTo: (id: string) => store.getState().reach(id),
    }),
    [store],
  )

  const dock = storyDock(area)
  const beside = content != null && focus.length > 0
  // With the code panel open, it explains the unit beside its code, and the card keeps only the step's name.
  const brief = beside && codeOpen
  const canOpenCode = own.some((id) => (nodeOf.get(id)?.anchors.length ?? 0) > 0)
  const last = useRef<number | null>(null)

  useLayoutEffect(() => {
    if (canvas.width < 2 || canvas.height < 2) return
    // Only a move moves the camera: nothing else that changes here frames anything again.
    if (last.current === move.key) return
    const first = last.current == null
    last.current = move.key
    const rectOf = new Map<string, Rect>(view.nodes.map((node) => [node.id, nodeRect(node.kind, node.position)]))
    const told = focus.filter((id) => rectOf.has(id))
    const graphArea = content ? dock.graph : area
    let target: Camera | null = null
    const framing = framingOf({ first, kind: move.kind, focus: told.length })
    const entry = content?.kind === 'step' ? entryCamera(view.story, content.index, rectOf, area) : null
    if (entry) {
      target = entry
    } else if (framing === 'reveal') {
      const now = cameraFor(rig.viewport.get(), graphArea)
      const camera = revealNode({ node: rectOf.get(told[0]!)!, camera: now, area: graphArea })
      if (camera) target = cameraFor(viewportFor(camera, graphArea), area)
    } else if (framing === 'step') {
      const changed = told.find((id) => isChangedCode(nodeOf.get(id)))
      const caller = changed ? drawnTrail(view, changed).at(-2) : undefined
      const tests = changed ? testCardOf(view, changed) : null
      const along = [caller, tests]
        .filter((id): id is string => id != null && !told.includes(id) && rectOf.has(id))
        .map((id) => rectOf.get(id)!)
      const shot = frameStep({ focus: told.map((id) => rectOf.get(id)!), along, area: graphArea })
      target = { ...shot.camera, offsetX: (graphArea.width - area.width) / 2 }
    } else if (content?.kind === 'step') {
      target = overviewCamera([...rectOf.values(), ...regionsOf(view.nodes, view.zones).map((region) => region.rect)])
    } else {
      // G with nothing in focus: all of the graph, inside the uncovered area.
      target = composeShot({ focus: [...rectOf.values()], area, card: null, others: [] }).camera
    }

    // Coming back to a review left for another page, the camera is where the reviewer left it.
    if (first && resume) target = resume
    if (target) {
      if (first || reduced) {
        rig.goTo(target, { cut: true })
      } else if (move.kind === 'step' || move.kind === 'jump') {
        const edge = move.travel ? view.edges.find((entry) => entry.id === move.travel!.wire) : undefined
        const ends = edge ? wireEnds(edge, view.nodes, view.flow) : null
        rig.goTo(target, { ride: ends && move.travel ? { curve: wireCurve(ends.source, ends.target, view.flow), reversed: move.travel.reversed } : null })
      } else {
        rig.goTo(target)
      }
    }
  }, [area, canvas.height, canvas.width, content, dock, focus, move, nodeOf, reduced, resume, rig, view])

  return (
    <>
      {content ? (
        <DockedCard box={dock.card} area={area} label={content.kind === 'step' ? 'This step' : 'This node'} placeKey={content.key}>
          {beside ? (
            <StepBody content={content} unit={unit} gap={ratingGap(units)} graph={graphFacts} ask={askAbout} actions={actions} canOpenCode={canOpenCode} brief={brief} code={code} />
          ) : content.kind === 'step' ? (
            <CardBody content={content} review={review} />
          ) : null}
        </DockedCard>
      ) : null}
      <NotesBeside area={area} step={content ? dock.card : null} />
      <BackPill show={!roam && offPath({ ...review, ...view }, story) && !content} step={story.step} onBack={actions.back} />
    </>
  )
}

/**
 * The notes of a node, or of a step, beside it for a quick read (the user, 2026-11-12): on whichever side has room in
 * the uncovered area, never over the step's card. It opens from a node's note count or from the steps panel
 * (`showNotes`), and Esc or a press anywhere else closes it. A node out of view is brought in first.
 */
function NotesBeside({ area, step }: { area: Rect; step: Rect | null }) {
  const store = useSessionStore()
  const rig = useRig()
  const shown = useSession((session) => session.notesShown)
  const notes = useSession((session) => session.notes)
  const view = useSession((session) => session.view)
  const nodeOf = useSession((session) => session.nodeOf)
  const focus = useSession((session) => session.focus)
  const lookup = useFlowStore((flow) => flow.nodeLookup)
  const measure = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<BesidePlace | null>(null)
  const width = notesWidth(area)

  // What it lists, and the node it stands beside: that node, or the node the step is told on.
  const listed = useMemo(() => {
    if (!shown) return null
    if (shown.kind === 'node') {
      const node = nodeOf.get(shown.node)
      if (!node) return null
      const group = view.groups[node.id]
      const members = group ? [...group.tests, ...group.helpers].map((id) => nodeOf.get(id)).filter((entry) => entry != null) : []
      return { key: `notes:node:${node.id}`, beside: node.id, title: `Notes on ${node.title}`, notes: notesAbout(notes, node, members) }
    }
    const index = view.stepOf[shown.step] ?? -1
    const steps = view.story[index]?.steps ?? [shown.step]
    const beside = focus[0] ?? null
    return beside ? { key: `notes:step:${shown.step}`, beside, title: `Notes on step ${index + 1}`, notes: notesOnStep(notes, steps) } : null
  }, [focus, nodeOf, notes, shown, view.groups, view.stepOf, view.story])
  const close = useMemo(() => () => store.getState().showNotes(null), [store])

  useLayoutEffect(() => {
    if (!listed) {
      setPlace(null)
      return
    }
    const node = nodeOf.get(listed.beside)
    const at = lookup.get(listed.beside)?.internals.positionAbsolute
    if (!node || !at) return
    const height = Math.min(measure.current?.offsetHeight ?? 200, area.height - 40)
    const rect = nodeRect(node.kind, at)
    // A node out of view comes into view first, by the least pan.
    const now = cameraFor(rig.viewport.get(), area)
    const target = revealNode({ node: rect, camera: now, area, card: { width, height } })
    if (target) rig.goTo(target)
    const viewport = viewportFor(target ?? now, area)
    const onScreen = (box: Rect) => ({ x: box.x * viewport.zoom + viewport.x, y: box.y * viewport.zoom + viewport.y, width: box.width * viewport.zoom, height: box.height * viewport.zoom })
    // Never over the step's card, nor over the nodes it is about.
    const keep = [
      ...(step ? [step] : []),
      ...focus.filter((id) => id !== listed.beside).flatMap((id) => (nodeOf.get(id) && lookup.get(id) ? [onScreen(nodeRect(nodeOf.get(id)!.kind, lookup.get(id)!.internals.positionAbsolute))] : [])),
    ]
    const others = view.nodes.filter((entry) => entry.id !== listed.beside).map((entry) => onScreen(nodeRect(entry.kind, entry.position)))
    const placed = placeCard({ node: onScreen(rect), card: { width, height }, keep, others, area })
    setPlace({ key: listed.key, node: listed.beside, kind: node.kind, side: placed.side, offset: placed.offset, zoom: viewport.zoom, width, height, most: height })
    // Placed when it opens, for what it lists: a pan or a drag carries it with its node afterwards, so nothing else places it.
  }, [listed?.key])

  // Esc closes it before the review hears the key, and so does a press anywhere but on it or on a note count. An Esc in
  // the proof beside the review is the proof's.
  useEffect(() => {
    if (!listed) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || inProofPanel(event.target)) return
      event.preventDefault()
      close()
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (!panel.current?.contains(target) && !target.closest('.rv-notes')) close()
    }
    addEventListener('keydown', onKey, true)
    addEventListener('pointerdown', onPointer, true)
    return () => {
      removeEventListener('keydown', onKey, true)
      removeEventListener('pointerdown', onPointer, true)
    }
  }, [close, listed])

  return (
    <>
      <div ref={measure} aria-hidden="true" inert className="rv-measure pointer-events-none invisible absolute top-0 left-0" style={{ width }}>
        {listed ? (
          <div className="rv-step" data-tone="notes">
            <NotesBody title={listed.title} notes={listed.notes} onClose={close} />
          </div>
        ) : null}
      </div>
      <AnimatePresence>
        {listed && place && place.key === listed.key ? (
          <div ref={panel} key={place.key}>
            <BesideCard place={place} label={listed.title} tone="notes">
              <NotesBody title={listed.title} notes={listed.notes} onClose={close} />
            </BesideCard>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  )
}

/** Only the lower edge moves. Tall content scrolls inside the available height. */
function DockedCard({ box, area, label, placeKey, children }: { box: Rect; area: Rect; label: string; placeKey: string; children: ReactNode }) {
  const rig = useRig()
  const reduced = useReduced()
  const body = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()
  const gap = area.x + area.width - box.x - box.width
  const right = useTransform(() => rig.proof.get() + gap)

  useLayoutEffect(() => {
    const element = body.current
    if (!element) return
    const measure = () => setHeight(element.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [placeKey])

  return (
    <motion.aside
      aria-label={label}
      className="rv-step overflow-hidden"
      style={{ position: 'absolute', zIndex: 10, right, top: box.y, width: box.width, maxHeight: box.height }}
      initial={false}
      animate={{ height: height == null ? 'auto' : Math.min(height, box.height) }}
      transition={reduced ? { duration: 0 } : tween.move}
    >
      <div className="rv-step-scroll" style={{ maxHeight: box.height }} key={placeKey}>
        <div ref={body}>{children}</div>
      </div>
    </motion.aside>
  )
}

/** Off the path with no text on screen, the way back is still one press away. */
function BackPill({ show, step, onBack }: { show: boolean; step: number; onBack: () => void }) {
  const rig = useRig()
  // Above the step pager, in the middle of what the steps panel, the outline and the proof leave uncovered.
  const lift = useTransform(() => `translateX(calc(-50% + ${uncoveredMiddle(rig)}px)) translateY(${-rig.panel.get()}px)`)
  return (
    <AnimatePresence>
      {show ? (
        <motion.div className="absolute bottom-[68px] left-1/2 z-10" style={{ transform: lift }}>
          <motion.button
            type="button"
            onClick={onBack}
            className="rv-float pressable flex h-8 items-center gap-2 rounded-full px-3.5 font-heading text-[14px] font-medium"
            initial={{ opacity: 0, transform: 'translateY(18px) scale(0.92)' }}
            animate={{ opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.rise, opacity: tween.enter } }}
            exit={{ opacity: 0, transform: 'translateY(8px) scale(0.96)', transition: tween.exit }}
            whileTap={{ transform: 'translateY(0px) scale(0.97)' }}
          >
            Back to step {step + 1}
            <kbd className="rounded-sm bg-muted px-1 font-sans text-[12px] text-muted-foreground">B</kbd>
          </motion.button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
