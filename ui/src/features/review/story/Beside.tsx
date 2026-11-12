import { useStore } from '@xyflow/react'
import { motion, useMotionValueEvent } from 'motion/react'
import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react'
import { NODE_SIZE } from '#shared/review/layout.ts'
import type { NodeKind } from '#shared/review/types.ts'
import { spring, tween } from '@/lib/motion.ts'
import { useReduced, useRig } from '../state/context.tsx'
import { besideAt, type CardSide, type Viewport } from './camera.ts'

/** Where a card stands beside its node: which node, which side, how far along it, and how big it may be. */
export interface BesidePlace {
  key: string
  node: string
  kind: NodeKind
  side: CardSide
  /** Canvas pixels along the side from the node's own edge, at the zoom it was placed at. */
  offset: number
  zoom: number
  width: number
  /** The most it may take. More than that scrolls. */
  height: number
}

/** Where a card stands on screen now, beside its node where the node is now: the box `BesideCard` draws it in. */
export function besideRect(place: BesidePlace, at: { x: number; y: number }, viewport: Viewport, height = place.height) {
  const size = NODE_SIZE[place.kind]
  const node = { x: at.x * viewport.zoom + viewport.x, y: at.y * viewport.zoom + viewport.y, width: size.width * viewport.zoom, height: size.height * viewport.zoom }
  return { node, card: besideAt(node, { width: place.width, height }, place.side, place.offset * (viewport.zoom / place.zoom)) }
}

/** The leader keeps this far from the card's ends. */
const LEADER_END = 18
/** Where a card comes in from: out of the node it is beside. */
const ARRIVES: Record<CardSide, string> = {
  right: 'translateX(-16px) scale(0.97)',
  left: 'translateX(16px) scale(0.97)',
  below: 'translateY(-14px) scale(0.97)',
  above: 'translateY(14px) scale(0.97)',
}
const SETTLED = 'translateX(0px) scale(1)'

/**
 * A card beside its node (the user, 2026-11-12: "on the right side, or left if no space"), joined to it by a short
 * leader. It is drawn over the canvas, not in the graph, so its type keeps its size at any zoom, and it follows its
 * node as the reviewer pans, zooms or drags the node. It comes out of its node once the camera is on its way.
 */
export function BesideCard({ place, label, tone, children }: { place: BesidePlace; label: string; tone: 'step' | 'notes'; children: ReactNode }) {
  const rig = useRig()
  const reduced = useReduced()
  const frame = useRef<HTMLDivElement>(null)
  const at = useStore(
    useCallback(
      (flow) => {
        const point = flow.nodeLookup.get(place.node)?.internals.positionAbsolute
        return point ? `${point.x} ${point.y}` : ''
      },
      [place.node],
    ),
  )

  const follow = useCallback(
    (viewport: Viewport) => {
      const element = frame.current
      if (!element || !at) return
      const [x = 0, y = 0] = at.split(' ').map(Number)
      const height = Math.min(element.offsetHeight || place.height, place.height)
      const { node, card } = besideRect(place, { x, y }, viewport, height)
      // The leader meets the card level with the middle of the node, kept off the card's rounded ends.
      const across = place.side === 'right' || place.side === 'left'
      const [middle, start, length] = across ? [node.y + node.height / 2, card.y, height] : [node.x + node.width / 2, card.x, place.width]
      const leader = Math.min(Math.max(middle - start, LEADER_END), Math.max(LEADER_END, length - LEADER_END))
      element.style.transform = `translate(${card.x}px, ${card.y}px)`
      element.style.setProperty('--leader-at', `${leader}px`)
    },
    [at, place],
  )
  useLayoutEffect(() => follow(rig.viewport.get()), [follow, rig])
  useMotionValueEvent(rig.viewport, 'change', follow)

  return (
    <div ref={frame} className="rv-beside" data-side={place.side} data-tone={tone} data-rv-beside={tone} style={{ width: place.width }}>
      <i className="rv-leader" aria-hidden="true" />
      <motion.aside
        aria-label={label}
        className="rv-step"
        data-tone={tone}
        initial={{ opacity: 0, transform: reduced ? SETTLED : ARRIVES[place.side] }}
        animate={{ opacity: 1, transform: SETTLED, transition: { transform: { ...spring.rise, delay: 0.12 }, opacity: { ...tween.enter, delay: 0.12 } } }}
        exit={{ opacity: 0, transition: tween.exit }}
      >
        <div className="rv-step-scroll" style={{ maxHeight: place.height }}>
          {children}
        </div>
      </motion.aside>
    </div>
  )
}
