/**
 * The review's conversation with hobkin: what the reviewer asked about this review, from the box or a quick link, and
 * hobkin's answers. The conversation itself is hobkin's main one. A message sent from the review is about the review,
 * and the answers that follow it belong to it until the next message. The review keeps its own copy, so the
 * conversation is still there when the review opens again after the chat has moved on.
 */
import type { ChatMessage } from '#shared/protocol/snapshot.ts'
import type { ThreadEntry } from '../state/memory.ts'

export { joinThread, THREAD_LIMIT, THREADS_KEPT, type ThreadEntry } from '../state/memory.ts'

/** What the conversation says each message from a review is about, up to the step: see `reviewBrief` in the host. */
export const reviewAbout = (title: string) => `Review "${title}"`

/**
 * A message the reviewer sent from the review that the conversation does not show yet. `sending`: on its way.
 * `queued`: hobkin took it and reads it after what it is doing. `taken`: hobkin is reading it. `failed`: it did not go.
 */
export interface PendingAsk {
  key: string
  text: string
  /** When it was sent, in milliseconds. */
  at: number
  state: 'sending' | 'queued' | 'taken' | 'failed'
  error?: string
}

/** A message's time in milliseconds. It arrives as a number, or as an ISO date. */
function millisecondsOf(at: ChatMessage['at']): number {
  if (typeof at === 'number') return at
  return at ? Date.parse(at) || 0 : 0
}

const entryOf = (message: ChatMessage): ThreadEntry => ({ id: message.id, who: message.role === 'user' ? 'you' : 'hobkin', text: message.content, at: millisecondsOf(message.at) })

/** The messages the reviewer sent about this review, each followed by hobkin's answers to it. */
export function reviewThread(messages: readonly ChatMessage[], title: string): ThreadEntry[] {
  const prefix = reviewAbout(title)
  const thread: ThreadEntry[] = []
  let answering = false
  for (const message of messages) {
    if (message.role === 'user') {
      answering = message.about?.startsWith(prefix) === true
      if (answering) thread.push(entryOf(message))
    } else if (answering && message.role === 'assistant') {
      thread.push(entryOf(message))
    }
  }
  return thread
}

/** True when the conversation's newest message from the reviewer is about this review: a reply being written is for it. */
export function answersReview(messages: readonly ChatMessage[], title: string): boolean {
  const last = messages.findLast((message) => message.role === 'user')
  return last?.about?.startsWith(reviewAbout(title)) === true
}

/**
 * The messages sent from the review that the conversation does not show yet, and the keys of those it does. A message
 * shows once the conversation has one of the reviewer's, about this review, stored after it was sent: each stored
 * message stands for one sent, in order.
 */
export function waitingAsks(asks: readonly PendingAsk[], thread: readonly ThreadEntry[]): { waiting: PendingAsk[]; settled: string[] } {
  const taken = new Set<string>()
  const waiting: PendingAsk[] = []
  const settled: string[] = []
  for (const ask of asks) {
    const copy = ask.state === 'failed' ? undefined : thread.find((entry) => entry.who === 'you' && !taken.has(entry.id) && entry.at >= ask.at)
    if (copy) {
      taken.add(copy.id)
      settled.push(ask.key)
    } else {
      waiting.push(ask)
    }
  }
  return { waiting, settled }
}

/** A line of the conversation as the panel draws it. `writing`: hobkin's reply as it is being written. */
export interface ConversationLine {
  key: string
  who: 'you' | 'hobkin'
  text: string
  state?: 'sending' | 'queued' | 'failed' | 'writing'
  error?: string
}

/** A question and the replies under it. `waiting`: hobkin has not said anything about it yet, and is on it. */
export interface Exchange {
  key: string
  lines: ConversationLine[]
  waiting: boolean
}

/**
 * The conversation as the panel shows it: each question with hobkin's replies under it, the newest exchange first, so
 * what was just asked sits under the box. A message just sent shows at once, and a reply as hobkin writes it.
 * `writing` is the reply being written, when it answers this review; `busy` is whether hobkin is working.
 */
export function conversationOf({ thread, asks, writing, busy }: { thread: readonly ThreadEntry[]; asks: readonly PendingAsk[]; writing: string | null; busy: boolean }): Exchange[] {
  const lines: ConversationLine[] = thread.map(({ id, who, text }) => ({ key: id, who, text }))
  const unsent = waitingAsks(asks, thread).waiting
  for (const ask of unsent) {
    lines.push({ key: ask.key, who: 'you', text: ask.text, ...(ask.state === 'taken' ? {} : { state: ask.state }), ...(ask.error ? { error: ask.error } : {}) })
  }
  if (writing?.trim()) lines.push({ key: 'writing', who: 'hobkin', text: writing, state: 'writing' })

  const exchanges: Exchange[] = []
  for (const line of lines) {
    const current = exchanges.at(-1)
    if (line.who === 'you' || !current) exchanges.push({ key: line.key, lines: [line], waiting: false })
    else current.lines.push(line)
  }
  // The newest question waits while hobkin works, or while it is on its way to hobkin.
  const newest = exchanges.at(-1)
  const question = newest?.lines.at(-1)
  if (newest && question?.who === 'you' && question.state !== 'failed') {
    newest.waiting = busy || unsent.some((ask) => ask.key === question.key)
  }
  return exchanges.reverse()
}
