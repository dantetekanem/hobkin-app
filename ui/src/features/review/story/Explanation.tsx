import { useStore } from '@xyflow/react'
import { ArrowLeft, CornerDownLeft } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, type ReactNode } from 'react'
import type { Point } from '#shared/review/layout.ts'
import type { Review, ReviewNode } from '#shared/review/types.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { KIND, LevelBadge, statusOf } from '../graph/kinds.tsx'
import type { Hung } from './camera.ts'
import type { CardContent } from './StepCard.tsx'

export interface ExplanationActions {
  focusOn(nodeId: string): void
  openCode(): void
  back(): void
}

/**
 * The step told in its node (the user, 2026-11-12): its number and level, its title and its text, the acceptance lines
 * it serves, and the way to its code. A node the reviewer stepped aside to says what it is, with the way back. Drawn
 * twice: once unseen, to measure it, and once in place under its node.
 *
 * `brief` is the text while the code panel is open. That panel explains the unit beside its code, so the node keeps
 * only the step's name and level: a step is never told twice.
 */
export function ExplanationBody({ content, review, actions, canOpenCode, brief = false }: { content: CardContent; review: Review; actions: ExplanationActions; canOpenCode: boolean; brief?: boolean }) {
  if (content.kind === 'node') return <NodeExplanation node={content.node} backTo={content.backTo} actions={actions} canOpenCode={canOpenCode} brief={brief} />
  const { step, index } = content
  return (
    <div className="rv-explain-body">
      <div className="rv-explain-eyebrow">
        <span>Step {index + 1}</span>
        {step.level ? <LevelBadge level={step.level} /> : null}
        {step.specStep ? <span>{step.specStep}</span> : null}
      </div>
      <h3 className="rv-explain-title">{step.title}</h3>
      {brief ? null : (
        <>
          {step.text ? <p className="rv-explain-text">{step.text}</p> : null}
          {step.criteria.length > 0 ? (
            <div className="rv-explain-row">
              <span>Serves</span>
              {step.criteria.map((id) => (
                <button key={id} type="button" className="rv-explain-chip" title={review.nodes.find((node) => node.id === id)?.summary} onClick={() => actions.focusOn(id)}>
                  {id}
                </button>
              ))}
            </div>
          ) : null}
          {canOpenCode ? (
            <div className="rv-explain-row">
              <button type="button" className="rv-explain-action" onClick={actions.openCode}>
                Open code
                <Kbd>
                  <CornerDownLeft />
                </Kbd>
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function NodeExplanation({ node, backTo, actions, canOpenCode, brief }: { node: ReviewNode; backTo: number; actions: ExplanationActions; canOpenCode: boolean; brief: boolean }) {
  const status = statusOf(node)
  const io = node.io && (node.io.in || node.io.out) ? node.io : null
  return (
    <div className="rv-explain-body">
      <div className="rv-explain-eyebrow">
        <span>{KIND[node.kind].label}</span>
        {node.level ? <LevelBadge level={node.level} /> : null}
        <span data-tone={status.tone}>{status.text}</span>
      </div>
      {brief ? null : (
        <>
          <p className="rv-explain-text">{node.summary}</p>
          {io ? (
            <p className="rv-explain-quiet">
              In: {io.in || 'nothing'}
              <br />
              Out: {io.out || 'nothing said'}
            </p>
          ) : null}
          {node.warning ? <p className="rv-explain-warning">{node.warning}</p> : null}
          {node.proof && !node.warning ? <p className="rv-explain-quiet">{node.proof}</p> : null}
        </>
      )}
      <div className="rv-explain-row">
        {canOpenCode && !brief ? (
          <button type="button" className="rv-explain-action" onClick={actions.openCode}>
            Open code
            <Kbd>
              <CornerDownLeft />
            </Kbd>
          </button>
        ) : null}
        <button type="button" className="rv-explain-action" onClick={actions.back}>
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Back to step {backTo + 1}
          <Kbd>B</Kbd>
        </button>
      </div>
    </div>
  )
}

/** Where the step's text is drawn: hung under a node, in points of the graph. */
export interface HungPlace {
  key: string
  /** The text, with the height the camera gave it. */
  text: Hung
  /** The height it wants. More than it was given, and it scrolls. */
  wants: number
  /** The node it hangs from, and where that node was when the text was placed. */
  node: string
  at: Point
}

/**
 * The step's text in place, inside the graph under the node it hangs from, so it moves and scales with that node and
 * follows it while the reviewer drags it. It rises out of the node once the camera is on its way, and leaves faster than
 * it came.
 */
export function HungText({ place, label, children }: { place: HungPlace; label: string; children: ReactNode }) {
  const live = useStore(
    useCallback(
      (flow) => {
        const at = flow.nodeLookup.get(place.node)?.internals.positionAbsolute
        return at ? `${at.x} ${at.y}` : ''
      },
      [place.node],
    ),
  )
  const [x = place.at.x, y = place.at.y] = live ? live.split(' ').map(Number) : []
  const scrolls = place.text.height < place.wants - 0.5

  return (
    <div className="rv-hung" style={{ width: place.text.width, transform: `translate(${place.text.x + x - place.at.x}px, ${place.text.y + y - place.at.y}px)` }}>
      <motion.aside
        aria-label={label}
        className="rv-explain"
        style={{ transformOrigin: '24px 0px' }}
        initial={{ opacity: 0, transform: 'translateY(-10px) scale(0.96)' }}
        animate={{ opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: { ...spring.rise, delay: 0.14 }, opacity: { ...tween.enter, delay: 0.14 } } }}
        exit={{ opacity: 0, transform: 'translateY(0px) scale(0.98)', transition: tween.exit }}
      >
        {/* Scrolling it takes the wheel from the graph, only when there is more of it than fits. */}
        <div className={cn('rv-explain-scroll', scrolls && 'nowheel')} style={{ maxHeight: place.text.height }}>
          {children}
        </div>
      </motion.aside>
    </div>
  )
}
