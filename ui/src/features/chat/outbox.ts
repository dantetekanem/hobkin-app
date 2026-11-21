import type { ChatMessage } from '#shared/protocol/snapshot.ts'
import { timeOf } from './conversation.ts'

/** A message the user sent that the stored conversation does not show yet. */
export interface OutboxEntry {
  id: number
  text: string
  /** How many images went with it. */
  images?: number
  /** Title of the report it is about. */
  about?: string
  /** When it was sent, in milliseconds. */
  at: number
  /** hobkin took it. Until then it shows as queued. */
  accepted: boolean
}

export interface Outbox {
  entries: readonly OutboxEntry[]
  /** Ids of stored messages already matched to something sent, so one stored message never clears two. */
  delivered: readonly string[]
}

export const emptyOutbox: Outbox = { entries: [], delivered: [] }

/**
 * What is still waiting once the stored conversation has moved on. The rule is the terminal app's
 * (`settleOutbox` in hobkin's `src/cli/ui.mjs`): a message leaves when the conversation shows a user message
 * stored after it was sent, or when hobkin took it and the turn ended without it.
 * Returns the same outbox when nothing changed.
 */
export function settleOutbox(outbox: Outbox, messages: readonly ChatMessage[], busy: boolean): Outbox {
  if (!outbox.entries.length) return outbox.delivered.length ? emptyOutbox : outbox

  const matched = new Set(outbox.delivered)
  const kept = outbox.entries.filter((entry) => {
    const copy = messages.find((message) => message.role === 'user' && !matched.has(message.id) && (timeOf(message.at) ?? 0) >= entry.at)
    if (copy) matched.add(copy.id)
    return !copy && !(entry.accepted && !busy)
  })
  if (kept.length === outbox.entries.length) return outbox
  return kept.length ? { entries: kept, delivered: [...matched] } : emptyOutbox
}

/**
 * The outbox once the stored conversation shows what was sent: only a stored copy takes an entry away. hobkin taking a
 * message says nothing yet about its turn, so whether the turn ended without it waits for the next state.
 */
export const settleStored = (outbox: Outbox, messages: readonly ChatMessage[]): Outbox => settleOutbox(outbox, messages, true)

/** What goes back into the input after a stop: what hobkin never read, ahead of what was being typed. */
export const draftAfterStop = (unsent: readonly string[], draft: string): string => [...unsent, draft].filter((text) => text.trim()).join('\n\n')
