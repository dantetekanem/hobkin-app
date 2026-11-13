import { Braces, Check, CircleCheck, CircleDashed, FileText, FlaskConical, Minus, Plus, ShieldCheck, Target, Trash2, TriangleAlert, Wrench, X, type LucideIcon } from 'lucide-react'
import type { NodeKind, ReviewLevel, ReviewNode } from '#shared/review/types.ts'

/** Kinds are told apart by icon and word first, and by color second. */
export const KIND: Record<NodeKind, { label: string; icon: LucideIcon }> = {
  criterion: { label: 'Acceptance', icon: Target },
  test: { label: 'Test', icon: FlaskConical },
  code: { label: 'Code', icon: Braces },
  file: { label: 'File', icon: FileText },
  context: { label: 'Context', icon: CircleDashed },
}

export interface NodeStatusView {
  text: string
  icon: LucideIcon
  tone: 'ok' | 'bad' | 'quiet'
}

/**
 * The small fact at the bottom right of a card: proven or not, a test's result, added or changed. A test's result is
 * one of four (the user, 2026-11-12): Passed, Failed, Proves the change (it fails with the change undone) or Not run.
 */
export function statusOf(node: Pick<ReviewNode, 'kind' | 'status' | 'change' | 'supports'>): NodeStatusView {
  if (node.kind === 'criterion') {
    return node.status === 'unproven' ? { text: 'Unproven', icon: TriangleAlert, tone: 'bad' } : { text: 'Proven', icon: CircleCheck, tone: 'ok' }
  }
  if (node.kind === 'test' && node.supports?.length) return { text: 'Test helper', icon: Wrench, tone: 'quiet' }
  if (node.kind === 'test') {
    if (node.status === 'passed') return { text: 'Passed', icon: Check, tone: 'ok' }
    if (node.status === 'proves-change') return { text: 'Proves the change', icon: ShieldCheck, tone: 'ok' }
    if (node.status === 'failed') return { text: 'Failed', icon: X, tone: 'bad' }
    return { text: 'Not run', icon: Minus, tone: 'quiet' }
  }
  if (node.change === 'added') return { text: 'New', icon: Plus, tone: 'quiet' }
  if (node.change === 'deleted') return { text: 'Deleted', icon: Trash2, tone: 'bad' }
  if (node.change === 'unchanged') return { text: 'Unchanged', icon: Minus, tone: 'quiet' }
  return { text: 'Changed', icon: Minus, tone: 'quiet' }
}

/** True for the two things a reviewer must not miss: a line with no proof and a test that failed. */
export function needsALook(node: Pick<ReviewNode, 'status'>): boolean {
  return node.status === 'unproven' || node.status === 'failed'
}

/**
 * The mark on a part of the change that can break: the one thing a reviewer must find. Risk itself is the whole
 * change's and is said once, in the header, so a part that only was not shown by a test, or is shown to work, carries
 * no mark at all. On a card it sits on the top edge (`.rv-level`).
 */
export function LevelBadge({ level, critical = false, size }: { level: ReviewLevel; critical?: boolean; size?: 'large' }) {
  if (level !== 'high') return null
  return (
    <span className="rv-level shrink-0" data-level={level} data-size={size} title={critical ? 'The review found a break here that needs a fix' : 'The review found something here that can break'}>
      Can break
      {critical ? ' · needs a fix' : ''}
    </span>
  )
}
