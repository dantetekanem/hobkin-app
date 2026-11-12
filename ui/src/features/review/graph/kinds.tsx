import { Braces, Check, CircleCheck, CircleDashed, FileText, FlaskConical, Minus, Plus, Target, Trash2, TriangleAlert, X, type LucideIcon } from 'lucide-react'
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

/** The small fact at the bottom right of a card: proven or not, passed or not, added or changed. */
export function statusOf(node: Pick<ReviewNode, 'kind' | 'status' | 'change'>): NodeStatusView {
  if (node.kind === 'criterion') {
    return node.status === 'unproven' ? { text: 'Unproven', icon: TriangleAlert, tone: 'bad' } : { text: 'Proven', icon: CircleCheck, tone: 'ok' }
  }
  if (node.kind === 'test' && node.status) {
    if (node.status === 'passed') return { text: 'Passed', icon: Check, tone: 'ok' }
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

const LEVEL_WORD: Record<ReviewLevel, string> = { safe: 'Safe', mid: 'Mid', high: 'High' }

/** The change review's level, as a word on its color (`.rv-level`). On a card it sits on the top edge. */
export function LevelBadge({ level, critical = false }: { level: ReviewLevel; critical?: boolean }) {
  return (
    <span className="rv-level shrink-0" data-level={level} title={`The change review rates this ${LEVEL_WORD[level].toLowerCase()}${critical ? ', and critical' : ''}`}>
      {LEVEL_WORD[level]}
      {critical ? ' · critical' : ''}
    </span>
  )
}
