import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronUp, Layers } from 'lucide-react'
import { motion } from 'motion/react'
import { memo } from 'react'
import { spring, tween } from '@/lib/motion.ts'
import { useSession, useSessionStore } from '../state/context.tsx'
import { useEntrance } from './entrance.tsx'
import { hoverShown } from './levels.ts'

const count = (value: number) => value.toLocaleString('en-US')

/**
 * A group card of a large change (spec 053, `graph/focus.ts`): the safe nodes of one kind or one folder, folded into one
 * card that looks like the others, with a second card edge behind it so it reads as many. It says what it holds, how
 * many files and lines, and why it can be read at a glance, and its button opens it in place, as Enter does. Open, it
 * stays at the head of its members and says how many of them are drawn; the rest are in the outline.
 */
function GroupCardComponent({ id }: NodeProps) {
  const store = useSessionStore()
  const group = useSession((session) => session.view.plan.groups[id])
  const open = useSession((session) => session.view.plan.open.includes(id))
  const shown = useSession((session) => session.view.plan.shown[id]?.length ?? 0)
  const level = useSession((session) => session.levels.nodes[id] ?? 'rest')
  const hover = useSession((session) => hoverShown(session.hover.nodes[id] ?? 'none', session.hovered, session.focus))
  const pins = useSession((session) => session.pins[id])
  const entrance = useEntrance(id)

  if (!group) return null
  const tests = group.kind === 'test'
  const members = group.members.length
  const what = tests ? (members === 1 ? 'card of tests' : 'cards of tests') : members === 1 ? 'part' : 'parts'
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <motion.div
        className="size-full"
        initial={entrance ? { opacity: 0, transform: entrance.quiet ? 'translateY(0px) scale(1)' : 'translateY(34px) scale(0.9)' } : false}
        animate={{ opacity: 1, transform: 'translateY(0px) scale(1)' }}
        transition={entrance ? { transform: { ...spring.rise, delay: entrance.delay }, opacity: { ...tween.enter, delay: entrance.delay } } : { duration: 0 }}
      >
        <div
          className="rv-node rv-fold"
          data-kind={tests ? 'test' : 'file'}
          data-status={tests ? 'passed' : undefined}
          data-level={level}
          data-hover={hover}
          data-group="true"
          data-open={open}
          data-node={id}
        >
          <div className="rv-card">
            <header className="rv-head">
              <Layers className="rv-icon" aria-hidden="true" />
              <span className="rv-title" title={group.label}>
                {group.label}
              </span>
              <span className="rv-kind">{group.standing === 'safe' ? 'Safe' : 'Group'}</span>
            </header>
            <div className="rv-body">
              <p className="rv-fold-count">
                {count(group.files)} {group.files === 1 ? 'file' : 'files'}
                {group.files !== members ? ` · ${count(members)} ${what}` : ''}
              </p>
              <p className="rv-summary" style={{ '--lines': 2 } as React.CSSProperties}>
                {open && shown < members ? `${count(shown)} of ${count(members)} drawn. The rest are in the outline (L).` : group.why}
              </p>
              <div className="rv-facts">
                <span className="rv-stats" aria-label={`${group.additions} lines added, ${group.deletions} removed`}>
                  <span className="rv-add">+{count(group.additions)}</span>
                  <span className="rv-del">−{count(group.deletions)}</span>
                </span>
                <button
                  type="button"
                  className="rv-group-toggle nodrag"
                  data-rv-fold={id}
                  aria-expanded={open}
                  onClick={(event) => {
                    // Opening the group is not focusing its card: the click is the button's.
                    event.stopPropagation()
                    store.getState().toggleGroup(id)
                  }}
                >
                  {open ? 'Close' : `Open the ${count(members)}`}
                  {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                </button>
              </div>
            </div>
          </div>
          <i className="rv-pin" data-side="left" data-wired={pins?.in ?? false} aria-hidden="true" />
          <i className="rv-pin" data-side="right" data-wired={pins?.out ?? false} aria-hidden="true" />
        </div>
      </motion.div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  )
}

export const GroupCard = memo(GroupCardComponent)
