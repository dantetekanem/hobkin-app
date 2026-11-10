import { AnimatePresence, motion, useTransform } from 'motion/react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { boundsOf, nodeRect, type Point } from '#shared/review/layout.ts'
import { spring, tween } from '@/lib/motion.ts'
import { wireCurve } from '../graph/wire-path.ts'
import { STEPS_STRIP, stepsPanelWidth } from '../panel/StepsPanel.tsx'
import { useReduced, useRig, useSession, useSessionStore } from '../state/context.tsx'
import { composeShot, pointToScreen, viewportFor, type CardSide, type PlacedCard, type Size, type Viewport } from './camera.ts'
import { CardBody, type CardContent } from './StepCard.tsx'
import { offPath } from './story.ts'
import { wireEnds } from './travel.ts'

/** How wide the text beside the focus is, for a canvas of a given width. */
const cardWidth = (canvas: number) => Math.round(Math.min(380, Math.max(288, canvas * 0.27)))

interface Placement {
  key: string
  card: PlacedCard
  /** The point of the graph the card stays beside, and the viewport it was placed for. */
  anchor: Point
  target: Viewport
}

/** Where a card comes in from: out of the focus it is about. */
const ARRIVES: Record<CardSide, string> = {
  right: 'translateX(-44px) translateY(0px) scale(0.92)',
  left: 'translateX(44px) translateY(0px) scale(0.92)',
  below: 'translateX(0px) translateY(-36px) scale(0.92)',
  above: 'translateX(0px) translateY(36px) scale(0.92)',
}
const SETTLED = 'translateX(0px) translateY(0px) scale(1)'

/**
 * Directs the story on screen: frames the focus inside the uncovered area whenever the step, the canvas
 * or the code panel changes, and places the step's text beside the focus.
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
  // The steps panel covers the left of the canvas by as much of it as is on screen.
  const side = panelOpen ? stepsPanelWidth(canvas.width) : STEPS_STRIP
  // With the panel open the step is told there in full, and the card beside the focus keeps only its name.
  const brief = panelOpen

  const content = useMemo<CardContent | null>(() => {
    if (story.detour) {
      const node = nodeOf.get(story.detour)
      return node ? { kind: 'node', key: `node:${node.id}`, node, backTo: story.step } : null
    }
    if (story.whole) return null
    const step = view.story[story.step]
    return step ? { kind: 'step', key: `step:${step.id}`, step, index: story.step, total: view.story.length } : null
  }, [nodeOf, story.detour, story.step, story.whole, view.story])

  const width = cardWidth(canvas.width)
  const measure = useRef<HTMLDivElement>(null)
  const last = useRef<{ move: number; panel: number; side: number; canvas: string; subject: string; card: number } | null>(null)
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
    const rects = view.nodes.map((node) => ({ id: node.id, rect: nodeRect(node.kind, node.position) }))
    const focused = new Set(focus)
    // With nothing in focus the whole graph is the subject.
    const subject = focused.size > 0 ? rects.filter((entry) => focused.has(entry.id)) : rects
    const others = focused.size > 0 ? rects.filter((entry) => !focused.has(entry.id)).map((entry) => entry.rect) : []
    const area = rig.area(panelHeight, side)
    const height = content ? (measure.current?.offsetHeight ?? 0) : 0
    const shot = composeShot({ focus: subject.map((entry) => entry.rect), area, card: content && height > 0 ? { width, height } : null, others })

    const now = {
      move: move.key,
      panel: panelHeight,
      side,
      canvas: `${canvas.width}x${canvas.height}`,
      subject: subject.map(({ rect }) => `${rect.x},${rect.y}`).join(' '),
      card: height,
    }
    const before = last.current
    // Nothing that decides the framing changed: a node elsewhere was moved, or the same step drew again.
    // The camera stays where the reviewer has it.
    if (before && before.move === now.move && before.panel === now.panel && before.side === now.side && before.canvas === now.canvas && before.subject === now.subject && before.card === now.card) return
    last.current = now
    if (!before || reduced) rig.goTo(shot.camera, { cut: true })
    else if (now.move !== before.move) {
      const edge = move.travel ? view.edges.find((entry) => entry.id === move.travel!.wire) : undefined
      const ends = edge ? wireEnds(edge, view.nodes) : null
      rig.goTo(shot.camera, { ride: ends && move.travel ? { curve: wireCurve(ends.source, ends.target), reversed: move.travel.reversed } : null })
    }
    // The panel rising and the canvas growing are the frame's own springs. The camera rides along at their pace.
    else rig.goTo(shot.camera, { transition: now.panel !== before.panel ? spring.sheet : spring.screen })

    const box = boundsOf(subject.map((entry) => entry.rect))
    setPlacement(shot.card && content ? { key: content.key, card: shot.card, anchor: { x: box.x + box.width / 2, y: box.y + box.height / 2 }, target: viewportFor(shot.camera, area) } : null)
    // `view.nodes` moves when the reviewer drops a node somewhere new, which re-frames too.
  }, [brief, canvas.width, canvas.height, content, focus, move, panelHeight, reduced, rig, side, view.edges, view.nodes, width])

  const shown = placement && content && placement.key === content.key ? placement : null

  return (
    <>
      {/* Measured before it is placed, so the camera knows how much room the text takes. */}
      <div ref={measure} aria-hidden="true" inert className="pointer-events-none invisible absolute top-0 left-0" style={{ width }}>
        {content ? <CardBody content={content} review={review} actions={actions} canOpenCode={canOpenCode} brief={brief} /> : null}
      </div>
      <AnimatePresence>
        {shown && content ? (
          <Card key={shown.key} placement={shown}>
            <CardBody content={content} review={review} actions={actions} canOpenCode={canOpenCode} brief={brief} />
          </Card>
        ) : null}
      </AnimatePresence>
      <BackPill show={offPath({ ...review, ...view }, story) && !content} step={story.step} onBack={actions.back} />
    </>
  )
}

/**
 * The text beside the focus. It is placed in canvas pixels and tied to a point of the graph, so it travels
 * in with the node it is about and stays beside it when the reviewer pans.
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
        // It rises out of the focus once the camera is on its way, and leaves faster than it came.
        initial={{ opacity: 0, transform: ARRIVES[card.side] }}
        animate={{ opacity: 1, transform: SETTLED, transition: { transform: { ...spring.rise, delay: 0.14 }, opacity: { ...tween.enter, delay: 0.14 } } }}
        exit={{ opacity: 0, transform: 'translateX(0px) translateY(0px) scale(0.96)', transition: tween.exit }}
      >
        {children}
      </motion.aside>
    </motion.div>
  )
}

/** Off the path with no card on screen, the way back is still one press away. */
function BackPill({ show, step, onBack }: { show: boolean; step: number; onBack: () => void }) {
  const rig = useRig()
  // Above the rail, in the middle of what the steps panel leaves uncovered.
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
            <kbd className="rounded-sm bg-muted px-1 font-sans text-[11px] text-muted-foreground">B</kbd>
          </motion.button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
