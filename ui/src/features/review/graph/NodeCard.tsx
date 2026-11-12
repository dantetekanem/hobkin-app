import { Handle, Position, type NodeProps } from '@xyflow/react'
import { MessageSquare } from 'lucide-react'
import { animate, motion } from 'motion/react'
import { memo, useEffect, useRef } from 'react'
import { spring, tween } from '@/lib/motion.ts'
import { useEntrance } from './entrance.tsx'
import { KIND, LevelBadge, needsALook, statusOf } from './kinds.tsx'
import { useReduced, useSession } from '../state/context.tsx'

/** Long titles take two lines of the header, which leaves one line for the summary. */
const TWO_LINE_TITLE = 34

/**
 * One node of the graph: a rounded card with a header tinted by kind, where it lives, one line on what
 * changed, and small facts. Everything it shows comes from the review file.
 */
function NodeCardComponent({ id }: NodeProps) {
  const node = useSession((session) => session.nodeOf.get(id))
  const level = useSession((session) => session.levels.nodes[id] ?? 'rest')
  const hover = useSession((session) => session.hover.nodes[id] ?? 'none')
  const seen = useSession((session) => session.revealed.has(id))
  const pins = useSession((session) => session.pins[id])
  const notes = useSession((session) => session.counts.nodes[id] ?? 0)
  // Goes up when this node draws in for the first time on a story move.
  const arrival = useSession((session) => (session.move.fresh.nodes.includes(id) ? session.move.key : 0))
  const entrance = useEntrance(id)
  const reduced = useReduced()
  const inner = useRef<HTMLDivElement>(null)

  // Purpose: state indication. A node the story reaches for the first time arrives, on later visits it is already there.
  // spring.alive, because arriving should feel alive and a fast walk can interrupt it.
  useEffect(() => {
    if (!arrival || reduced || !inner.current) return
    const playing = animate(inner.current, { transform: ['translateY(18px) scale(0.92)', 'translateY(0px) scale(1)'] }, spring.alive)
    return () => playing.stop()
  }, [arrival, reduced])

  if (!node) return null
  const { icon: Icon, label } = KIND[node.kind]
  const status = statusOf(node)
  const criterion = node.kind === 'criterion'
  const longTitle = node.title.length > TWO_LINE_TITLE
  const io = !criterion && node.io && (node.io.in || node.io.out) ? node.io : null
  // What goes in and out takes a line of its own, so the summary gives one up.
  const lines = criterion ? 3 : longTitle || io ? 1 : 2

  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <motion.div
        ref={inner}
        className="size-full"
        // The entrance: each node rises into place, column by column. Skipped when the review has been seen, or motion is reduced.
        initial={entrance ? { opacity: 0, transform: 'translateY(34px) scale(0.9)' } : false}
        animate={{ opacity: 1, transform: 'translateY(0px) scale(1)' }}
        transition={entrance ? { transform: { ...spring.rise, delay: entrance.delay }, opacity: { ...tween.enter, delay: entrance.delay } } : { duration: 0 }}
      >
        <div
          className="rv-node"
          data-kind={node.kind}
          data-level={level}
          data-hover={hover}
          data-seen={seen}
          data-status={node.status}
          data-change={node.change}
          data-alert={needsALook(node)}
          data-node={id}
        >
          <div className="rv-card">
            <header className="rv-head">
              <Icon className="rv-icon" aria-hidden="true" />
              <span className="rv-title" title={node.title}>
                {node.title}
              </span>
              <span className="rv-kind">{label}</span>
            </header>
            <div className="rv-body">
              {criterion ? null : (
                <span className="rv-path" title={node.subtitle}>
                  <bdi>{node.subtitle}</bdi>
                </span>
              )}
              <p className="rv-summary" style={{ '--lines': lines } as React.CSSProperties}>
                {node.summary}
              </p>
              {io ? (
                <p className="rv-io" title={`In: ${io.in || 'nothing'}\nOut: ${io.out || 'nothing said'}`}>
                  <span>{io.in || 'nothing'}</span>
                  <span aria-hidden="true"> → </span>
                  <span className="rv-io-out">{io.out || '…'}</span>
                </p>
              ) : null}
              <div className="rv-facts">
                {node.stats && !criterion && node.kind !== 'context' ? (
                  <span className="rv-stats" aria-label={`${node.stats.additions} lines added, ${node.stats.deletions} removed`}>
                    <span className="rv-add">+{node.stats.additions}</span>
                    <span className="rv-del">−{node.stats.deletions}</span>
                  </span>
                ) : criterion && node.warning ? (
                  <span className="truncate text-bad-fg" title={node.warning}>
                    {node.proof ? 'Its test is missing' : 'No Proof line'}
                  </span>
                ) : criterion ? (
                  <span className="truncate text-muted-foreground">{node.proof?.startsWith('check:') ? 'By a check' : 'By a test'}</span>
                ) : null}
                <span className="rv-status" data-tone={status.tone}>
                  <status.icon aria-hidden="true" />
                  {status.text}
                </span>
              </div>
            </div>
          </div>
          {node.level ? <LevelBadge level={node.level} /> : null}
          {notes > 0 ? (
            <span className="rv-notes" aria-label={`${notes} ${notes === 1 ? 'note' : 'notes'}`}>
              <MessageSquare aria-hidden="true" />
              {notes}
            </span>
          ) : null}
          <i className="rv-pin" data-side="left" data-wired={pins?.in ?? false} aria-hidden="true" />
          <i className="rv-pin" data-side="right" data-wired={pins?.out ?? false} aria-hidden="true" />
        </div>
      </motion.div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  )
}

export const NodeCard = memo(NodeCardComponent)
