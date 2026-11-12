import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronUp, Minus, MessageSquare, ShieldCheck, Unlink, X, Check } from 'lucide-react'
import { animate, motion } from 'motion/react'
import { memo, useEffect, useRef } from 'react'
import type { ReviewNode } from '#shared/review/types.ts'
import { spring, tween } from '@/lib/motion.ts'
import { notesAbout } from '../state/quick-notes.ts'
import { useReduced, useSession, useSessionStore } from '../state/context.tsx'
import type { Session } from '../state/session.ts'
import { isLineCount, type TestGroup } from './arrange.ts'
import { useEntrance } from './entrance.tsx'
import { KIND, LevelBadge, needsALook, statusOf } from './kinds.tsx'
import { hoverShown, isUnchanged } from './levels.ts'

/** Long titles take two lines of the header, which leaves one line for the summary. */
const TWO_LINE_TITLE = 34
/** How many of the folded nodes a count names when the pointer is over it. */
const NAMED = 6

/** How many notes a card has: those about its node, its lines, and the tests it holds. */
function notesOn(session: Session, id: string): number {
  const node = session.nodeOf.get(id)
  if (!node) return 0
  const group = session.view.groups[id]
  const members = group ? [...group.tests, ...group.helpers].map((member) => session.nodeOf.get(member)).filter((entry): entry is ReviewNode => entry != null) : []
  return notesAbout(session.notes, node, members).length
}

/**
 * One node of the graph: a rounded card with a header tinted by kind, where it lives, what it is, and small facts.
 * Everything it shows comes from the review file. A test says what it covers and how it ran, and a card of folded tests
 * counts them and lists them in place. A count of lines is never the main text: it stays small in the footer. Code the
 * change did not touch is marked Unchanged and steps back, a node nothing wires says why, and a focus node counts the
 * wires it folded away beside the pin they would leave by.
 */
function NodeCardComponent({ id }: NodeProps) {
  const store = useSessionStore()
  const node = useSession((session) => session.nodeOf.get(id))
  const group = useSession((session) => session.view.groups[id])
  const covers = useSession((session) => {
    const subject = session.view.covers[id]
    return subject ? (session.nodeOf.get(subject)?.title ?? null) : null
  })
  const level = useSession((session) => session.levels.nodes[id] ?? 'rest')
  const folded = useSession((session) => session.levels.folded?.[id])
  const hover = useSession((session) => hoverShown(session.hover.nodes[id] ?? 'none', session.hovered, session.focus))
  const seen = useSession((session) => session.revealed.has(id))
  const pins = useSession((session) => session.pins[id])
  const notes = useSession((session) => notesOn(session, id))
  const listed = useSession((session) => session.opened === id)
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
  const unchanged = isUnchanged(node)
  // The mark on the top edge says Unchanged, so the status says it again only for a test, whose status is its result.
  const quiet = unchanged && node.kind !== 'test'
  const criterion = node.kind === 'criterion'
  const test = node.kind === 'test'
  const longTitle = node.title.length > TWO_LINE_TITLE
  const io = !criterion && !test && node.io && (node.io.in || node.io.out) ? node.io : null
  const said = isLineCount(node.summary) ? null : node.summary
  // What goes in and out, what a test covers, and why a node stands apart each take a line, so the summary gives one up.
  const taken = [longTitle, Boolean(io), test && Boolean(covers || node.supports?.length), Boolean(node.unwired)].filter(Boolean).length
  const lines = criterion ? 3 : Math.max(0, 2 - taken)

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
          data-unchanged={unchanged}
          data-alert={needsALook(node)}
          data-group={group != null}
          data-apart={Boolean(node.unwired)}
          data-node={id}
        >
          <div className="rv-card">
            <header className="rv-head">
              <Icon className="rv-icon" aria-hidden="true" />
              <span className="rv-title" title={node.title}>
                {node.title}
              </span>
              <span className="rv-kind">{group ? 'Tests' : label}</span>
            </header>
            <div className="rv-body">
              {criterion ? null : (
                <span className="rv-path" title={node.subtitle}>
                  <bdi>{node.subtitle}</bdi>
                </span>
              )}
              {node.unwired ? (
                <p className="rv-unwired" title={node.unwired}>
                  <Unlink aria-hidden="true" />
                  {node.unwired}
                </p>
              ) : null}
              {group ? (
                <GroupCounts group={group} />
              ) : test && node.supports?.length ? (
                <p className="rv-covers">
                  Used by {node.supports.length} {node.supports.length === 1 ? 'test' : 'tests'}
                </p>
              ) : test && covers ? (
                <p className="rv-covers" title={`Covers ${covers}`}>
                  <span>Covers</span> {covers}
                </p>
              ) : null}
              {said && !group && lines > 0 ? (
                <p className="rv-summary" style={{ '--lines': lines } as React.CSSProperties}>
                  {said}
                </p>
              ) : null}
              {io ? (
                <p className="rv-io" title={`In: ${io.in || 'nothing'}\nOut: ${io.out || 'nothing said'}`}>
                  <span>{io.in || 'nothing'}</span>
                  <span aria-hidden="true"> → </span>
                  <span className="rv-io-out">{io.out || '…'}</span>
                </p>
              ) : null}
              <div className="rv-facts">
                <Fact node={node} />
                {group ? (
                  <button
                    type="button"
                    className="rv-group-toggle nodrag"
                    data-rv-tests={id}
                    aria-expanded={listed}
                    onClick={(event) => {
                      // The card itself is not clicked: opening the list is not focusing the card.
                      event.stopPropagation()
                      store.getState().openTests(listed ? null : id)
                    }}
                  >
                    {listed ? 'Hide the tests' : `Show the ${group.tests.length}`}
                    {listed ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                  </button>
                ) : quiet ? null : test ? (
                  <span className="rv-result" data-tone={status.tone} data-proves={node.status === 'proves-change'}>
                    <status.icon aria-hidden="true" />
                    {status.text}
                  </span>
                ) : (
                  <span className="rv-status" data-tone={status.tone}>
                    <status.icon aria-hidden="true" />
                    {status.text}
                  </span>
                )}
              </div>
            </div>
          </div>
          {unchanged ? (
            <span className="rv-tags">
              {node.level ? <LevelBadge level={node.level} /> : null}
              <span className="rv-unchanged" title={node.kind === 'test' ? 'This test did not change. A Proof line names it.' : 'Not part of this change: code around it, on the way a request goes through.'}>
                Unchanged
              </span>
            </span>
          ) : node.level ? (
            <LevelBadge level={node.level} />
          ) : null}
          {folded?.in.length ? <More side="left" ids={folded.in} /> : null}
          {folded?.out.length ? <More side="right" ids={folded.out} /> : null}
          {notes > 0 ? (
            <button
              type="button"
              className="rv-notes nodrag"
              aria-label={`${notes} ${notes === 1 ? 'note' : 'notes'}: read ${notes === 1 ? 'it' : 'them'}`}
              title={`Read the ${notes === 1 ? 'note' : `${notes} notes`}`}
              onClick={(event) => {
                event.stopPropagation()
                store.getState().showNotes({ node: id })
              }}
            >
              <MessageSquare aria-hidden="true" />
              {notes}
            </button>
          ) : null}
          <i className="rv-pin" data-side="left" data-wired={pins?.in ?? false} aria-hidden="true" />
          <i className="rv-pin" data-side="right" data-wired={pins?.out ?? false} aria-hidden="true" />
        </div>
      </motion.div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  )
}

/** What the tests of a card did: how many ran, failed and were not run, and how many prove the change. */
function GroupCounts({ group }: { group: TestGroup }) {
  const { ran, failed, notRun, proves } = group.counts
  return (
    <p className="rv-counts" aria-label={`${ran} ran, ${failed} failed, ${notRun} not run${proves ? `, ${proves} prove the change` : ''}`}>
      <span data-tone="ok">
        <Check aria-hidden="true" />
        {ran} ran
      </span>
      <span data-tone={failed > 0 ? 'bad' : 'none'}>
        <X aria-hidden="true" />
        {failed} failed
      </span>
      <span data-tone={notRun > 0 ? 'quiet' : 'none'}>
        <Minus aria-hidden="true" />
        {notRun} not run
      </span>
      {proves > 0 ? (
        <span data-tone="ok" title="These fail with the change undone, so they prove the change itself.">
          <ShieldCheck aria-hidden="true" />
          {proves} prove it
        </span>
      ) : null}
    </p>
  )
}

/** The left fact of a card's footer: lines changed, small, or how an acceptance line is proven. */
function Fact({ node }: { node: ReviewNode }) {
  if (node.kind === 'criterion') {
    if (node.warning) {
      return (
        <span className="truncate text-bad-fg" title={node.warning}>
          {node.proof ? 'Its test is missing' : 'No Proof line'}
        </span>
      )
    }
    return <span className="truncate text-muted-foreground">{node.proof?.startsWith('check:') ? 'By a check' : 'By a test'}</span>
  }
  if (node.stats && node.kind !== 'context') {
    return (
      <span className="rv-stats" aria-label={`${node.stats.additions} lines added, ${node.stats.deletions} removed`}>
        <span className="rv-add">+{node.stats.additions}</span>
        <span className="rv-del">−{node.stats.deletions}</span>
      </span>
    )
  }
  return null
}

/** The count of wires a focus node folded away on one side, naming the first few nodes they lead to. */
function More({ side, ids }: { side: 'left' | 'right'; ids: readonly string[] }) {
  const nodeOf = useSession((session) => session.nodeOf)
  const names = ids.slice(0, NAMED).map((other) => nodeOf.get(other)?.title ?? other)
  const rest = ids.length - names.length
  const said = `${ids.length} more ${ids.length === 1 ? 'connection' : 'connections'} not drawn for this step: ${names.join(', ')}${rest > 0 ? `, and ${rest} more` : ''}`
  return (
    <span className="rv-more" data-side={side} title={said} aria-label={said}>
      +{ids.length} more
    </span>
  )
}

export const NodeCard = memo(NodeCardComponent)
