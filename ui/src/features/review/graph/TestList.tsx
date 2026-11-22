import { useStore, ViewportPortal } from '@xyflow/react'
import { Wrench, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef } from 'react'
import { NODE_SIZE } from '#shared/review/layout.ts'
import type { ReviewNode } from '#shared/review/types.ts'
import { tween } from '@/lib/motion.ts'
import { inProofPanel } from '../keys.ts'
import { useReduced, useSession, useSessionStore } from '../state/context.tsx'
import { statusOf } from './kinds.tsx'

/** The list hangs this far under its card, in points of the graph. */
const UNDER = 10

/**
 * The tests of a card, listed under it in place (the user, 2026-11-12): each test's name and result, and the helpers
 * they use. A row opens that test's code. Esc, a click elsewhere or the card's own toggle closes it. It is drawn over the
 * graph, so it never moves a node, and it follows its card while the reviewer drags it.
 */
export function TestList() {
  const opened = useSession((session) => session.opened)
  return (
    <ViewportPortal>
      <AnimatePresence>{opened ? <OpenList key={opened} id={opened} /> : null}</AnimatePresence>
    </ViewportPortal>
  )
}

function OpenList({ id }: { id: string }) {
  const store = useSessionStore()
  const group = useSession((session) => session.view.groups[id])
  const card = useSession((session) => session.nodeOf.get(id))
  const nodeOf = useSession((session) => session.nodeOf)
  const code = useSession((session) => session.code)
  const reduced = useReduced()
  const list = useRef<HTMLDivElement>(null)
  const at = useStore(
    useCallback(
      (flow) => {
        const place = flow.nodeLookup.get(id)?.internals.positionAbsolute
        return place ? `${place.x} ${place.y}` : ''
      },
      [id],
    ),
  )

  // Esc closes it before the review hears the key, and so does a press anywhere but on it or on its toggle. An Esc in
  // the proof beside the review is the proof's.
  useEffect(() => {
    const close = () => store.getState().openTests(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || inProofPanel(event.target)) return
      event.preventDefault()
      close()
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (!list.current?.contains(target) && !target.closest(`[data-rv-tests="${CSS.escape(id)}"]`)) close()
    }
    addEventListener('keydown', onKey, true)
    addEventListener('pointerdown', onPointer, true)
    return () => {
      removeEventListener('keydown', onKey, true)
      removeEventListener('pointerdown', onPointer, true)
    }
  }, [id, store])

  if (!group || !card || !at) return null
  const [x = 0, y = 0] = at.split(' ').map(Number)
  const rows = [...group.tests, ...group.helpers].map((member) => nodeOf.get(member)).filter((node): node is ReviewNode => node != null)

  return (
    <motion.div
      ref={list}
      role="region"
      aria-label={`The ${card.title}`}
      className="rv-tests nodrag nopan nowheel"
      style={{ left: x, top: y + NODE_SIZE[card.kind].height + UNDER, width: NODE_SIZE[card.kind].width + 48 }}
      initial={{ opacity: 0, transform: reduced ? 'translateY(0px)' : 'translateY(-6px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)', transition: tween.enter }}
      exit={{ opacity: 0, transition: tween.exit }}
    >
      <header className="rv-tests-head">
        <span>{card.title}</span>
        <button type="button" className="rv-tests-close" aria-label="Close the list" onClick={() => store.getState().openTests(null)}>
          <X aria-hidden="true" />
        </button>
      </header>
      <ul className="rv-tests-rows">
        {rows.map((node) => {
          const helper = group.helpers.includes(node.id)
          const result = statusOf(node)
          const Icon = helper ? Wrench : result.icon
          return (
            <li key={node.id}>
              <button
                type="button"
                className="rv-tests-row"
                data-current={code === node.id}
                title={node.summary}
                onClick={() => void store.getState().openCode(node.id)}
              >
                <Icon className="rv-tests-icon" data-tone={result.tone} aria-hidden="true" />
                <span className="rv-tests-name">{node.title}</span>
                <span className="rv-tests-result" data-tone={result.tone}>
                  {helper ? `Used by ${node.supports?.length ?? 0}` : result.text}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </motion.div>
  )
}
