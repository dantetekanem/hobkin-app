import type { FinishedChange } from '#shared/protocol/work.ts'
import type { HobkinChoice } from './actions.ts'

/**
 * What a row's "⋯" menu lists (_specs/066-work-one-list): every choice hobkin gave the change, in its words and
 * order, with Review first when none of them opens the change, and a way to reply last. Pure, so it is tested without a window.
 */

export type MenuKind = 'choice' | 'review' | 'open' | 'again' | 'confirm' | 'reply'

export interface MenuItem {
  id: string
  kind: MenuKind
  label: string
  /** What hobkin carries out, for a choice and for Close without merging. */
  choice?: Exclude<HobkinChoice, 'review' | 'changes'>
  /** Cannot be taken back: the menu marks it. Close without merging also asks twice. */
  destructive?: boolean
  disabled?: boolean
}

export interface MenuContext {
  /** The change has a review to open in Change Review. */
  canReview: boolean
  /** Its change review is queued or running, so it cannot be asked again. */
  reviewing: boolean
  /** The row has a reply box to open. */
  canReply: boolean
}

export function menuItemsOf(change: Pick<FinishedChange, 'choices' | 'pr' | 'left'>, { canReview, reviewing, canReply }: MenuContext): MenuItem[] {
  const items: MenuItem[] = []
  if (canReview && !change.choices.some(({ value }) => value === 'diff')) items.push({ id: 'review', kind: 'review', label: 'Review' })
  for (const { value, label } of change.choices) {
    if (value === 'diff') {
      if (canReview) items.push({ id: value, kind: 'review', label })
    } else if (value === 'open') {
      if (change.pr) items.push({ id: value, kind: 'open', label })
    } else if (value === 'review') {
      items.push({ id: value, kind: 'again', label, disabled: reviewing })
    } else if (value === 'done') {
      items.push({ id: value, kind: 'confirm', label, choice: value, destructive: true })
    } else {
      items.push({ id: value, kind: 'choice', label, choice: value, destructive: value === 'decline' })
    }
  }
  if (canReply) items.push({ id: 'reply', kind: 'reply', label: change.left ? 'Reply to its note' : 'Ask for changes' })
  return items
}
