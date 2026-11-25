import type { WireSnapshot } from '../../../../shared/protocol/snapshot.ts'
import type { WaitingRow } from './items.ts'

/**
 * Dismissing an action item: it leaves Action Items unanswered, through hobkin's own dismissal, and can be brought back
 * for a moment after. Pure, so the rules are tested without a window. Spec: 012-reports-actions.
 */

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

/** When the project was offered, from the offer itself in the host's waiting list. hobkin offers a project once at a time. */
function offeredAt(snapshot: WireSnapshot, slug: string): string | null {
  const asks = record(snapshot.waiting)?.asks
  if (!Array.isArray(asks)) return null

  const offer = asks.map(record).find((entry) => entry?.kind === 'proposal' && entry.slug === slug)
  return typeof offer?.offeredAt === 'string' ? offer.offeredAt : null
}

/**
 * hobkin's own id for the card, as its hobkin_action_items tool lists it (`listActionItems` in its `src/cli/pending-read.mjs`):
 * a decision by its id, a learning offer and a project offer by what was offered and when. Null for a row hobkin does not
 * list there: a sample, or a step that is cleared in Work.
 */
export function dismissIdOf(row: WaitingRow, snapshot: WireSnapshot): string | null {
  const answers = row.answers
  switch (answers?.by) {
    case 'decision':
      return answers.id
    case 'learning':
      return `learning:${answers.id}:${row.at ?? ''}`
    case 'proposal': {
      const at = offeredAt(snapshot, answers.slug)
      return at === null ? null : `project:${answers.slug}:${at}`
    }
    default:
      return null
  }
}

/** Whether hobkin lists the card, so it can be dismissed there: one of hobkin's decisions, a learning offer or a project offer. */
export function canDismiss(row: WaitingRow): boolean {
  const by = row.answers?.by
  return by === 'decision' || by === 'learning' || by === 'proposal'
}

/**
 * Backspace or Delete dismisses the item that has the keyboard, as it deletes a report in Reports. Typed in a field, it is
 * text. The screens pass on a key held with Command, Control or Option before they ask.
 */
export function dismissesKey(key: string, typing: boolean): boolean {
  return !typing && (key === 'Backspace' || key === 'Delete')
}
