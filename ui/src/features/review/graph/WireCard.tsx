import { AnimatePresence, motion, useTransform } from 'motion/react'
import { WIRE_PHRASE } from '#shared/review/types.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { spring, tween } from '@/lib/motion.ts'
import type { ViewEdge } from '../state/memory.ts'
import { useRig, useSession, useSessionStore } from '../state/context.tsx'
import { pointToScreen } from '../story/camera.ts'
import { wireEnds } from '../story/travel.ts'
import { wireCurve } from './wire-path.ts'

/**
 * What a wire says when it is clicked: the two nodes it joins, its kind in words, and its label.
 * A wire the model proposed offers Confirm and Remove. The choice is the reviewer's and is remembered.
 */
export function WireCard() {
  const edge = useSession((session) => (session.wire ? session.edgeOf.get(session.wire) : undefined))
  return <AnimatePresence>{edge ? <OpenWire key={edge.id} edge={edge} /> : null}</AnimatePresence>
}

function OpenWire({ edge }: { edge: ViewEdge }) {
  const store = useSessionStore()
  const rig = useRig()
  const nodes = useSession((session) => session.view.nodes)
  const flow = useSession((session) => session.view.flow)
  const from = useSession((session) => session.nodeOf.get(edge.from))
  const to = useSession((session) => session.nodeOf.get(edge.to))
  const ends = wireEnds(edge, nodes, flow)
  const middle = wireCurve(ends.source, ends.target, flow).middle
  // It sits just under the wire's middle and follows the graph.
  const transform = useTransform(() => {
    const at = pointToScreen(middle, rig.viewport.get())
    return `translate(${at.x}px, ${at.y + 18}px) translateX(-50%)`
  })
  const decide = (decision: 'confirmed' | 'removed' | null) => {
    store.getState().decideWire(edge.id, decision)
    if (decision === 'removed') store.getState().openWire(null)
  }

  return (
    <motion.div className="pointer-events-none absolute top-0 left-0 z-20" style={{ transform }}>
      <motion.div
        role="group"
        aria-label="This wire"
        data-wire-card={edge.id}
        className="rv-float pointer-events-auto flex w-[300px] flex-col gap-2 rounded-[18px] p-3.5"
        style={{ transformOrigin: '50% 0%' }}
        initial={{ opacity: 0, transform: 'translateY(-10px) scale(0.92)' }}
        animate={{ opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.alive, opacity: tween.enter } }}
        exit={{ opacity: 0, transform: 'translateY(-4px) scale(0.96)', transition: tween.exit }}
      >
        <p className="text-[13.5px] leading-snug text-pretty">
          <strong className="font-heading font-semibold [overflow-wrap:anywhere]">{from?.title}</strong>
          <span className="text-muted-foreground"> {WIRE_PHRASE[edge.kind]} </span>
          <strong className="font-heading font-semibold [overflow-wrap:anywhere]">{to?.title}</strong>
        </p>
        {edge.label ? <p className="text-[13px] leading-snug text-muted-foreground">{edge.label}</p> : null}
        <p className="text-[12px] text-muted-foreground">
          {edge.certainty === 'host' ? 'Read from the code.' : edge.proposed ? 'Proposed by the model. Not confirmed yet.' : 'Proposed by the model. You confirmed it.'}
        </p>
        {edge.certainty === 'model' ? (
          <div className="flex gap-2 pt-0.5">
            {edge.proposed ? (
              <Button size="sm" onClick={() => decide('confirmed')}>
                Confirm <Kbd className="bg-primary-foreground/15 text-primary-foreground">Y</Kbd>
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => decide(null)}>
                Undo <Kbd>Y</Kbd>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => decide('removed')}>
              Remove <Kbd>R</Kbd>
            </Button>
          </div>
        ) : null}
      </motion.div>
    </motion.div>
  )
}
