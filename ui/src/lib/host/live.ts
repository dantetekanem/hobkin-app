import type { ChatMessage } from '#shared/protocol/snapshot.ts'
import type { TurnEvent } from '#shared/protocol/turn.ts'

/** A reply as it is being written: its text blocks by content index, and whether the model has finished it. */
export interface LiveReply {
  /** Its place among the replies of this turn. It stays the same while earlier replies leave, so what draws it stays the same too. */
  serial: number
  blocks: readonly (string | undefined)[]
  done: boolean
}

/**
 * Replies of the running turn that hobkin has not stored yet, oldest first. hobkin stores a reply a moment
 * after it ends, and a turn that uses tools writes several, so more than one can be waiting here.
 */
export interface LiveTurn {
  /** Ids of the stored messages these replies come after. A stored reply outside this set is one of them, stored. */
  known: readonly string[]
  replies: readonly LiveReply[]
  /** How many replies this turn has opened so far. */
  opened: number
}

export const replyText = (reply: LiveReply): string => reply.blocks.filter((block) => block !== undefined).join('\n')

const withLast = (live: LiveTurn, change: (reply: LiveReply) => LiveReply): LiveTurn => {
  const last = live.replies.at(-1)
  return last && !last.done ? { ...live, replies: [...live.replies.slice(0, -1), change(last)] } : live
}

const withBlock = (reply: LiveReply, index: number, text: (now: string) => string): LiveReply => {
  const blocks = [...reply.blocks]
  blocks[index] = text(blocks[index] ?? '')
  return { ...reply, blocks }
}

/** Closes the reply being written. One with no words, such as a bare tool call, is dropped: hobkin shows no message for it. */
function closeLast(live: LiveTurn): LiveTurn | null {
  const last = live.replies.at(-1)
  if (!last || last.done) return live

  const earlier = live.replies.slice(0, -1)
  if (replyText(last).trim()) return { ...live, replies: [...earlier, { ...last, done: true }] }
  return earlier.length ? { ...live, replies: earlier } : null
}

/** The live replies after one more event of the turn. `storedIds` are the ids on screen when the event arrived. */
export function applyTurnEvent(live: LiveTurn | null, event: TurnEvent, storedIds: readonly string[]): LiveTurn | null {
  if (event.kind === 'message-start') {
    if (event.role !== 'assistant') return live
    const reply: LiveReply = { serial: live?.opened ?? 0, blocks: [], done: false }
    return live ? { ...live, replies: [...live.replies, reply], opened: live.opened + 1 } : { known: storedIds, replies: [reply], opened: 1 }
  }
  if (!live) return null

  switch (event.kind) {
    case 'text-start':
      return withLast(live, (reply) => withBlock(reply, event.index, () => ''))
    case 'text-delta':
      return withLast(live, (reply) => withBlock(reply, event.index, (now) => now + event.delta))
    case 'text-end':
      return withLast(live, (reply) => withBlock(reply, event.index, () => event.text))
    case 'message-end':
      return event.role === 'assistant' ? closeLast(live) : live
    case 'end':
    case 'settled':
      return closeLast(live)
    default:
      return live
  }
}

/**
 * What is still live once hobkin's state has caught up. Each finished reply leaves when its stored copy arrives,
 * in order, and nothing stays once hobkin says the turn is over.
 */
export function settleLive(live: LiveTurn | null, messages: readonly ChatMessage[], busy: boolean | undefined): LiveTurn | null {
  if (!live || busy === false) return null

  const stored = messages.filter((message) => message.role === 'assistant' && !live.known.includes(message.id))
  let taken = 0
  while (taken < stored.length && live.replies[taken]?.done) taken += 1
  if (!taken) return live

  const replies = live.replies.slice(taken)
  return replies.length ? { ...live, known: [...live.known, ...stored.slice(0, taken).map((message) => message.id)], replies } : null
}

/** The stored messages to draw beside the live replies. A stored copy of a reply still being written waits for it to finish. */
export function storedBesideLive(messages: readonly ChatMessage[], live: LiveTurn | null): readonly ChatMessage[] {
  if (!live) return messages
  const known = new Set(live.known)
  return messages.filter((message) => message.role !== 'assistant' || known.has(message.id))
}
