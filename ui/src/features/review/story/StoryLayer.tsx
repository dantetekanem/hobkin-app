import { ViewportPortal } from '@xyflow/react'
import { AnimatePresence, motion, useTransform } from 'motion/react'
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { boundsOf, NODE_SIZE, nodeRect, type Point, type Rect } from '#shared/review/layout.ts'
import { spring, tween } from '@/lib/motion.ts'
import { wireCurve } from '../graph/wire-path.ts'
import { STEPS_STRIP, stepsPanelWidth } from '../panel/StepsPanel.tsx'
import { useReduced, useRig, useSession, useSessionStore } from '../state/context.tsx'
import { composeShot, FRAME, frameFocus, pointToScreen, viewportFor, type Camera, type CardSide, type PlacedCard, type Size, type Viewport } from './camera.ts'
import { ExplanationBody, HungText, type HungPlace } from './Explanation.tsx'
import { CardBody, type CardContent } from './StepCard.tsx'
import { offPath } from './story.ts'
import { wireEnds } from './travel.ts'

/** How wide the text beside the whole graph is, for a canvas of a given width. */
const cardWidth = (canvas: number) => Math.round(Math.min(380, Math.max(288, canvas * 0.27)))

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
 * Directs the story on screen: frames the focus inside the uncovered area whenever the step, the canvas or the code
 * panel changes, and tells the step in its node (the user, 2026-11-12). The camera frames the focus at a size its cards
 * read at, never pulled back for what it is wired to, and hangs the step's text right under its node. The opening and
 * the closing have no focus: they frame the whole graph and are told beside it.
 *
 * Each cause moves the camera its own way. A step travels, along the connecting wire when there is one.
 * The code panel opening carries the graph up in the same movement. A change of canvas size retargets,
 * so the graph keeps its place while the frame grows or shrinks the canvas on its spring.
 */
export function StoryLayer({ canvas, panelHeight }: { canvas: Size; panelHeight: number }) {
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

  // With a focus the step is told in its node, at the node's width. Without one it is told beside the whole graph.
  const inNode = content != null && focus.length > 0
  const width = inNode ? NODE_SIZE[nodeOf.get(focus[0]!)?.kind ?? 'code'].width : cardWidth(canvas.width)
  // With the code panel open, it explains the unit beside its code, and the node keeps only the step's name.
  const brief = inNode && codeOpen
  const measure = useRef<HTMLDivElement>(null)
  const last = useRef<{ move: number; panel: number; side: number; canvas: string; subject: string; text: number } | null>(null)
  const [hung, setHung] = useState<HungPlace | null>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const canOpenCode = focus.some((id) => (nodeOf.get(id)?.anchors.length ?? 0) > 0)
  const actions = useMemo(
    () => ({
      focusOn: (nodeId: string) => store.getState().focusOn(nodeId),
      openCode: () => void store.getState().openCode(),
      back: () => store.getState().back(),
    }),
    [store],
  )

  useLayoutEffect(() => {
    if (canvas.width < 2 || canvas.height < 2) return
    const rectOf = new Map<string, Rect>(view.nodes.map((node) => [node.id, nodeRect(node.kind, node.position)]))
    const told = focus.filter((id) => rectOf.has(id))
    const area = rig.area(panelHeight, side)
    const height = content ? (measure.current?.offsetHeight ?? 0) : 0

    let camera: Camera
    let nextHung: HungPlace | null = null
    let nextCard: Placement | null = null
    let subject: Rect[]
    if (told.length > 0) {
      subject = told.map((id) => rectOf.get(id)!)
      const shot = frameFocus({ focus: subject, area, text: content && height > 0 ? height : null })
      camera = shot.camera
      const node = shot.text ? told[shot.text.anchor] : undefined
      if (shot.text && content && node) nextHung = { key: content.key, text: shot.text, wants: height, node, at: { x: rectOf.get(node)!.x, y: rectOf.get(node)!.y } }
    } else {
      // With nothing in focus the whole graph is the subject. A story that opens or closes on it frames it closer, and
      // G, which asks for all of it, fits it whole.
      subject = [...rectOf.values()]
      const shot = composeShot({ focus: subject, area, card: content && height > 0 ? { width, height } : null, others: [], closer: move.kind !== 'whole' ? FRAME.closer : 1 })
      camera = shot.camera
      const box = boundsOf(subject)
      if (shot.card && content) nextCard = { key: content.key, card: shot.card, anchor: { x: box.x + box.width / 2, y: box.y + box.height / 2 }, target: viewportFor(shot.camera, area) }
    }

    const now = {
      move: move.key,
      panel: panelHeight,
      side,
      canvas: `${canvas.width}x${canvas.height}`,
      subject: subject.map((rect) => `${rect.x},${rect.y}`).join(' '),
      text: height,
    }
    const before = last.current
    // Nothing that decides the framing changed: a node elsewhere was moved, or the same step drew again.
    // The camera stays where the reviewer has it.
    const sameFraming =
      before != null &&
      before.move === now.move &&
      before.panel === now.panel &&
      before.side === now.side &&
      before.canvas === now.canvas &&
      before.subject === now.subject &&
      before.text === now.text
    if (sameFraming) return
    last.current = now
    if (!before || reduced) {
      rig.goTo(camera, { cut: true })
    } else if (now.move !== before.move) {
      const edge = move.travel ? view.edges.find((entry) => entry.id === move.travel!.wire) : undefined
      const ends = edge ? wireEnds(edge, view.nodes) : null
      rig.goTo(camera, { ride: ends && move.travel ? { curve: wireCurve(ends.source, ends.target), reversed: move.travel.reversed } : null })
    } else {
      // The panel rising and the canvas growing are the frame's own springs. The camera rides along at their pace.
      rig.goTo(camera, { transition: now.panel !== before.panel ? spring.sheet : spring.screen })
    }

    setHung(nextHung)
    setPlacement(nextCard)
    // `view.nodes` moves when the reviewer drops a node somewhere new, which re-frames too.
  }, [brief, canvas.width, canvas.height, content, focus, move, panelHeight, reduced, rig, side, view.edges, view.nodes, width])

  const shownHung = hung && content && hung.key === content.key ? hung : null
  const shownCard = placement && content?.kind === 'step' && placement.key === content.key ? { placement, content } : null

  let measured: ReactNode = null
  if (content && inNode) {
    measured = <ExplanationBody content={content} review={review} actions={actions} canOpenCode={canOpenCode} brief={brief} />
  } else if (content?.kind === 'step') {
    measured = <CardBody content={content} review={review} />
  }

  return (
    <>
      {/* Measured before it is placed, so the camera knows how much room the text takes. */}
      <div ref={measure} aria-hidden="true" inert className="pointer-events-none invisible absolute top-0 left-0" style={{ width }}>
        {measured}
      </div>
      <ViewportPortal>
        <AnimatePresence>
          {shownHung && content ? (
            <HungText key={shownHung.key} place={shownHung} label={content.kind === 'step' ? 'This step' : 'This node'}>
              <ExplanationBody content={content} review={review} actions={actions} canOpenCode={canOpenCode} brief={brief} />
            </HungText>
          ) : null}
        </AnimatePresence>
      </ViewportPortal>
      <AnimatePresence>
        {shownCard ? (
          <Card key={shownCard.placement.key} placement={shownCard.placement}>
            <CardBody content={shownCard.content} review={review} />
          </Card>
        ) : null}
      </AnimatePresence>
      <BackPill show={offPath({ ...review, ...view }, story) && !content} step={story.step} onBack={actions.back} />
    </>
  )
}

/**
 * The text of the opening or the closing beside the whole graph. It is placed in canvas pixels and tied to a point of
 * the graph, so it stays beside it when the reviewer pans.
 */
function Card({ placement, children }: { placement: Placement; children: React.ReactNode }) {
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
        className="rv-float rv-scroll pointer-events-auto overflow-y-auto rounded-[20px]"
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
            className="rv-float flex h-8 items-center gap-2 rounded-full px-3.5 font-heading text-[13px] font-medium"
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
