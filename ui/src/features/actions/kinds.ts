import { CalendarClock, GitMerge, Hand, ListStart, MessageCircleQuestionMark, Workflow, type LucideIcon } from 'lucide-react'
import type { ItemKind } from './items.ts'

/** Each kind of thing that waits, in the user's words, with its icon. */
export const KIND: Record<ItemKind, { label: string; icon: LucideIcon }> = {
  merge: { label: 'Finished branch', icon: GitMerge },
  yours: { label: 'Only you can do this', icon: Hand },
  approval: { label: 'Shipping approval', icon: GitMerge },
  work: { label: 'Work needs attention', icon: Workflow },
  routine: { label: 'Routine', icon: CalendarClock },
  pickup: { label: 'What to start', icon: ListStart },
  question: { label: 'Question', icon: MessageCircleQuestionMark },
}

const PHRASE: Record<ItemKind, [one: string, many: string]> = {
  merge: ['finished branch', 'finished branches'],
  yours: ['step only you can take', 'steps only you can take'],
  work: ['work question', 'work questions'],
  approval: ['shipping approval', 'shipping approvals'],
  routine: ['from a routine', 'from routines'],
  pickup: ['pick of what to start', 'picks of what to start'],
  question: ['question', 'questions'],
}

const ORDER: readonly ItemKind[] = ['merge', 'approval', 'yours', 'work', 'routine', 'pickup', 'question']

/** What waits, said in one line: "2 finished branches, 1 work question and 3 from routines". */
export function breakdown(kinds: Partial<Record<ItemKind, number>>): string {
  const parts = ORDER.filter((kind) => (kinds[kind] ?? 0) > 0).map((kind) => {
    const count = kinds[kind]!
    return `${count} ${PHRASE[kind][count === 1 ? 0 : 1]}`
  })
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}
