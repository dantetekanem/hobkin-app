import { useStore as useFlowStore } from '@xyflow/react'
import { AnimatePresence, motion, useTransform } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Unit } from '#shared/review/assessment.ts'
import { boundsOf, nodeRect, type Point, type Rect } from '#shared/review/layout.ts'
import { spring, tween } from '@/lib/motion.ts'
import { wireCurve } from '../graph/wire-path.ts'
import type { AskCommand } from '../panel/ask.ts'
import { STEPS_STRIP, stepsPanelWidth } from '../panel/StepsPanel.tsx'
import { useAskHobkin } from '../panel/use-ask.ts'
import { unitInFocus } from '../reading/model.ts'
import { useReduced, useRig, useSession, useSessionStore } from '../state/context.tsx'
import { notesAbout, notesOnStep } from '../state/quick-notes.ts'
import { BesideCard, besideRect, type BesidePlace } from './Beside.tsx'
import { cameraFor, composeShot, frameOpening, frameStep, framingOf, placeCard, pointToScreen, revealNode, viewportFor, type Camera, type CardSide, type PlacedCard, type Size, type Viewport } from './camera.ts'
import { NotesBody } from './NotesBody.tsx'
import { StepBody, type CardGraph } from './StepBody.tsx'
import { CardBody, type CardContent } from './StepCard.tsx'
import { offPath } from './story.ts'
import { wireEnds } from './travel.ts'

/** How wide the text beside the whole graph is, for a canvas of a given width. */
const cardWidth = (canvas: number) => Math.round(Math.min(380, Math.max(288, canvas * 0.27)))
/** How wide a card beside a node is, for the uncovered area: wide enough to read, never more than the room. */
const besideWidth = (area: Rect) => Math.round(Math.max(240, Math.min(400, Math.max(320, area.width * 0.36), area.width - 40)))
/** The notes panel is a little narrower than the step's card. */
const notesWidth = (area: Rect) => Math.round(Math.max(240, Math.min(340, area.width - 40)))

/** The text of the opening or the closing beside the whole graph, in canvas pixels. */
interface Placement {
  key: string
  card: PlacedCard
  /** The point of the graph the card stays beside, and the viewport it was placed for. */
  anchor: Point
  target: Viewport
}

/** Where a card comes in from: out of the graph it is about. */
const ARRIVES: Record<CardSide, string> = {
  right: 'translateX(-44px) translateY(0px) scale(0.92)',
  left: 'translateX(44px) translateY(0px) scale(0.92)',
  below: 'translateX(0px) translateY(-36px) scale(0.92)',
  above: 'translateX(0px) translateY(36px) scale(0.92)',
}
const SETTLED = 'translateX(0px) translateY(0px) scale(1)'

/**
 * Directs the story on screen (the user, 2026-11-12: "this navigation is completely broken... it wants to show the whole
 * connection"). Only a step moves the camera: going to a step, a jump to one, G, or hobkin's cursor frames it, at a size
 * its cards read at, inside the area the menus, the steps panel, the pager and the code panel leave uncovered, with its
 * card beside the node it tells. Nothing else frames anything: panning, zooming, dragging a node, the panels opening
 * and the canvas growing leave the camera where the reviewer has it, and a node looked at is told where it is. Only a
 * node out of view is brought in, by the least pan that does it. The opening and the closing have no focus: they frame
 * the whole graph, inside the uncovered area, and are told beside it.
 *
 * A step travels to its focus, along the connecting wire when there is one, and its card comes out of its node.
 */
export function StoryLayer({ canvas, panelHeight, units, ask = null }: {
  canvas: Size
  panelHeight: number
  /** The change review's units, when it has rated this change. */
  units?: readonly Unit[]
  /** Sends to hobkin, for a live review. */
  ask?: AskCommand | null
}) {
  const store = useSessionStore()
  const rig = useRig()
  const reduced = useReduced()
  const review = useSession((session) => session.review)
  const view = useSession((session) => session.view)
  const focus = useSession((session) => session.focus)
  const story = useSession((session) => session.story)
  const move = useSession((session) => session.move)
  const nodeOf = useSession((session) => session.nodeOf)
  const panelOpen = useSession((session) => session.panelOpen)
  const codeOpen = useSession((session) => session.code != null)
  // The steps panel covers the left of the canvas by as much of it as is on screen.
  const side = panelOpen ? stepsPanelWidth(canvas.width) : STEPS_STRIP
  const area = rig.area(panelHeight, side)

  const content = useMemo<CardContent | null>(() => {
    if (story.detour) {
      const node = nodeOf.get(story.detour)
      return node ? { kind: 'node', key: `node:${node.id}`, node, backTo: story.step } : null
    }
    // The whole graph, or a unit's nodes shown from the story: no step is told beside them. "Back to step N" waits below.
    if (story.whole || story.group) return null
    const step = view.story[story.step]
    return step ? { kind: 'step', key: `step:${step.id}`, step, index: story.step, total: view.story.length } : null
  }, [nodeOf, story.detour, story.group, story.step, story.whole, view.story])

  // The unit a step tells, by its own name or by its nodes', and the unit of a node looked at.
  const unit = useMemo(() => {
    if (!content || !units?.length) return undefined
    if (content.kind === 'node') return content.node.unit ? units.find((entry) => entry.id === content.node.unit) : undefined
    const named = content.step.unit ? units.find((entry) => entry.id === content.step.unit) : undefined
    return named ?? unitInFocus(units, content.step.focus.map((id) => nodeOf.get(id)).filter((node) => node != null), null)
  }, [content, nodeOf, units])
  const graphFacts = useMemo<CardGraph>(() => ({ covers: view.covers, groups: view.groups, nodeOf }), [nodeOf, view.covers, view.groups])
  // hobkin is asked about a node of the review: a card of folded tests stands for its first test.
  const about = content?.kind === 'node' ? content.node.id : focus[0]
  const askAbout = useAskHobkin(ask, about ? (view.groups[about]?.tests[0] ?? about) : null)
  const actions = useMemo(() => ({ openCode: () => void store.getState().openCode(), back: () => store.getState().back() }), [store])

  // With a focus the step is told beside its node. Without one it is told beside the whole graph.
  const beside = content != null && focus.length > 0
  const width = beside ? besideWidth(area) : cardWidth(canvas.width)
  // With the code panel open, it explains the unit beside its code, and the card keeps only the step's name.
  const brief = beside && codeOpen
  const canOpenCode = focus.some((id) => (nodeOf.get(id)?.anchors.length ?? 0) > 0)
  const measure = useRef<HTMLDivElement>(null)
  const last = useRef<number | null>(null)
  const [besidePlace, setBesidePlace] = useState<BesidePlace | null>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)

  useLayoutEffect(() => {
    if (canvas.width < 2 || canvas.height < 2) return
    // Only a move moves the camera: nothing else that changes here frames anything again.
    if (last.current === move.key) return
    const first = last.current == null
    last.current = move.key
    const rectOf = new Map<string, Rect>(view.nodes.map((node) => [node.id, nodeRect(node.kind, node.position)]))
    const told = focus.filter((id) => rectOf.has(id))
    const others = view.nodes.filter((node) => !told.includes(node.id)).map((node) => rectOf.get(node.id)!)
    const height = content ? (measure.current?.offsetHeight ?? 0) : 0
    const card = content && height > 0 ? { width, height } : null

    let target: Camera | null = null
    let nextBeside: BesidePlace | null = null
    let nextCard: Placement | null = null
    const framing = framingOf({ first, kind: move.kind, focus: told.length })
    if (framing === 'reveal') {
      // A node looked at: it is told where it is. The camera moves only when it is out of view, by the least pan.
      const now = cameraFor(rig.viewport.get(), area)
      target = revealNode({ node: rectOf.get(told[0]!)!, camera: now, area, card, others })
      const camera = target ?? now
      if (card && content) {
        const viewport = viewportFor(camera, area)
        const onScreen = (rect: Rect) => ({ x: rect.x * viewport.zoom + viewport.x, y: rect.y * viewport.zoom + viewport.y, width: rect.width * viewport.zoom, height: rect.height * viewport.zoom })
        const placed = placeCard({ node: onScreen(rectOf.get(told[0]!)!), card: { width, height: Math.min(height, area.height - 40) }, others: others.map(onScreen), area })
        nextBeside = { key: content.key, node: told[0]!, kind: nodeOf.get(told[0]!)!.kind, side: placed.side, offset: placed.offset, zoom: camera.zoom, width, height: placed.height }
      }
    } else if (framing === 'step') {
      // A step, a jump, hobkin's cursor, G on a focus, or opening on one: the step is framed with its card beside its node.
      const shot = frameStep({ focus: told.map((id) => rectOf.get(id)!), others, area, card })
      target = shot.camera
      if (shot.card && content) {
        const node = told[shot.card.anchor]!
        nextBeside = { key: content.key, node, kind: nodeOf.get(node)!.kind, side: shot.card.side, offset: shot.card.offset, zoom: shot.camera.zoom, width: shot.card.width, height: shot.card.height }
      }
    } else if (card && content) {
      // The opening or the closing: the whole graph, inside the uncovered area, with its card as tall as its words in
      // the top right corner, the graph framed in the room beside it.
      const subject = [...rectOf.values()]
      const shot = frameOpening({ graph: subject, area, card })
      target = shot.camera
      const box = boundsOf(subject)
      nextCard = { key: content.key, card: shot.card, anchor: { x: box.x + box.width / 2, y: box.y + box.height / 2 }, target: viewportFor(shot.camera, area) }
    } else {
      // G with nothing in focus: all of the graph, inside the uncovered area.
      target = composeShot({ focus: [...rectOf.values()], area, card: null, others: [] }).camera
    }

    if (target) {
      if (first || reduced) {
        rig.goTo(target, { cut: true })
      } else if (move.kind === 'step' || move.kind === 'jump') {
        const edge = move.travel ? view.edges.find((entry) => entry.id === move.travel!.wire) : undefined
        const ends = edge ? wireEnds(edge, view.nodes) : null
        rig.goTo(target, { ride: ends && move.travel ? { curve: wireCurve(ends.source, ends.target), reversed: move.travel.reversed } : null })
      } else {
        rig.goTo(target)
      }
    }
    setBesidePlace(nextBeside)
    setPlacement(nextCard)
  }, [area, canvas.height, canvas.width, content, focus, move, nodeOf, reduced, rig, view.edges, view.nodes, width])

  const shownBeside = besidePlace && content && besidePlace.key === content.key ? besidePlace : null
  const shownCard = placement && content?.kind === 'step' && placement.key === content.key ? { placement, content } : null
  const body = (inPlace: boolean) =>
    content && beside ? (
      <StepBody content={content} unit={unit} rated={Boolean(units?.length)} graph={graphFacts} ask={inPlace ? askAbout : null} actions={actions} canOpenCode={canOpenCode} brief={brief} />
    ) : content?.kind === 'step' ? (
      <CardBody content={content} review={review} />
    ) : null

  return (
    <>
      {/* Measured before it is placed, so the camera knows how much room the card takes. */}
      <div ref={measure} aria-hidden="true" inert className="rv-measure pointer-events-none invisible absolute top-0 left-0" style={{ width }}>
        {beside ? <div className="rv-step">{body(false)}</div> : body(false)}
      </div>
      <AnimatePresence>
        {shownBeside && content ? (
          <BesideCard key={shownBeside.key} place={shownBeside} label={content.kind === 'step' ? 'This step' : 'This node'} tone="step">
            {body(true)}
          </BesideCard>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {shownCard ? (
          <Card key={shownCard.placement.key} placement={shownCard.placement}>
            <CardBody content={shownCard.content} review={review} />
          </Card>
        ) : null}
      </AnimatePresence>
      <NotesBeside area={area} step={shownBeside} />
      <BackPill show={offPath({ ...review, ...view }, story) && !content} step={story.step} onBack={actions.back} />
    </>
  )
}

/**
 * The notes of a node, or of a step, beside it for a quick read (the user, 2026-11-12): on whichever side has room in
 * the uncovered area, never over the step's card. It opens from a node's note count or from the steps panel
 * (`showNotes`), and Esc or a press anywhere else closes it. A node out of view is brought in first.
 */
function NotesBeside({ area, step }: { area: Rect; step: BesidePlace | null }) {
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
    const beside = step?.node ?? focus[0] ?? null
    return beside ? { key: `notes:step:${shown.step}`, beside, title: `Notes on step ${index + 1}`, notes: notesOnStep(notes, steps) } : null
  }, [focus, nodeOf, notes, shown, step?.node, view.groups, view.stepOf, view.story])
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
      ...(step && lookup.get(step.node) ? [besideRect(step, lookup.get(step.node)!.internals.positionAbsolute, viewport).card] : []),
      ...focus.filter((id) => id !== listed.beside).flatMap((id) => (nodeOf.get(id) && lookup.get(id) ? [onScreen(nodeRect(nodeOf.get(id)!.kind, lookup.get(id)!.internals.positionAbsolute))] : [])),
    ]
    const others = view.nodes.filter((entry) => entry.id !== listed.beside).map((entry) => onScreen(nodeRect(entry.kind, entry.position)))
    const placed = placeCard({ node: onScreen(rect), card: { width, height }, keep, others, area })
    setPlace({ key: listed.key, node: listed.beside, kind: node.kind, side: placed.side, offset: placed.offset, zoom: viewport.zoom, width, height })
    // Placed when it opens, for what it lists: a pan or a drag carries it with its node afterwards, so nothing else places it.
  }, [listed?.key])

  // Esc closes it before the review hears the key, and so does a press anywhere but on it or on a note count.
  useEffect(() => {
    if (!listed) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
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

/**
 * The text of the opening or the closing beside the whole graph. It is placed in canvas pixels and tied to a point of
 * the graph, so it stays beside it when the reviewer pans.
 */
function Card({ placement, children }: { placement: Placement; children: ReactNode }) {
  const rig = useRig()
  const { card, anchor, target } = placement
  const transform = useTransform(() => {
    const now = pointToScreen(anchor, rig.viewport.get())
    const then = pointToScreen(anchor, target)
    return `translate(${card.x + now.x - then.x}px, ${card.y + now.y - then.y}px)`
  })

  return (
    <motion.div className="pointer-events-none absolute top-0 left-0 z-10" style={{ transform, width: card.width }}>
      <motion.aside
        aria-label="This step"
        className="rv-step rv-step-scroll pointer-events-auto"
        style={{ maxHeight: card.height }}
        // It rises out of the graph once the camera is on its way, and leaves faster than it came.
        initial={{ opacity: 0, transform: ARRIVES[card.side] }}
        animate={{ opacity: 1, transform: SETTLED, transition: { transform: { ...spring.rise, delay: 0.14 }, opacity: { ...tween.enter, delay: 0.14 } } }}
        exit={{ opacity: 0, transform: 'translateX(0px) translateY(0px) scale(0.96)', transition: tween.exit }}
      >
        {children}
      </motion.aside>
    </motion.div>
  )
}

/** Off the path with no text on screen, the way back is still one press away. */
function BackPill({ show, step, onBack }: { show: boolean; step: number; onBack: () => void }) {
  const rig = useRig()
  // Above the step pager, in the middle of what the steps panel leaves uncovered.
  const lift = useTransform(() => `translateX(calc(-50% + ${rig.side.get() / 2}px)) translateY(${-rig.panel.get()}px)`)
  return (
    <AnimatePresence>
      {show ? (
        <motion.div className="absolute bottom-[68px] left-1/2 z-10" style={{ transform: lift }}>
          <motion.button
            type="button"
            onClick={onBack}
            className="rv-float flex h-8 items-center gap-2 rounded-full px-3.5 font-heading text-[14px] font-medium"
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
