/**
 * The review panel's track: the reviewer's notes, hobkin's notes, and what the reviewer asked hobkin about this review
 * with its answers, in the order they happened. The conversation is hobkin's main one. A message the reviewer sent from
 * the review is about the review, and the answers that follow it belong to it until the next message.
 */
import type { ChatMessage } from '#shared/protocol/snapshot.ts'
import type { Note } from '../notes/notes.ts'

/** What the conversation says each message from a review is about, up to the step: see `reviewBrief` in the host. */
export const reviewAbout = (title: string) => `Review "${title}"`

/** The messages the reviewer sent about this review, each followed by hobkin's answers to it. */
export function reviewThread(messages: readonly ChatMessage[], title: string): ChatMessage[] {
  const prefix = reviewAbout(title)
  const thread: ChatMessage[] = []
  let answering = false
  for (const message of messages) {
    if (message.role === 'user') {
      answering = message.about?.startsWith(prefix) === true
      if (answering) thread.push(message)
    } else if (answering && message.role === 'assistant') thread.push(message)
  }
  return thread
}

export type TrackEntry =
  | { kind: 'note'; id: string; who: 'you' | 'hobkin'; at: number; note: Note }
  | { kind: 'message'; id: string; who: 'you' | 'hobkin'; at: number; text: string }

/** A message's time in milliseconds. It arrives as a number, or as an ISO date. */
function millisecondsOf(at: ChatMessage['at']): number {
  if (typeof at === 'number') return at
  return at ? Date.parse(at) || 0 : 0
}

export function reviewTrack(notes: readonly Note[], thread: readonly ChatMessage[]): TrackEntry[] {
  const entries: TrackEntry[] = [
    ...notes.map((note): TrackEntry => ({ kind: 'note', id: note.id, who: note.author === 'hobkin' ? 'hobkin' : 'you', at: note.at, note })),
    ...thread.map((message): TrackEntry => ({ kind: 'message', id: message.id, who: message.role === 'user' ? 'you' : 'hobkin', at: millisecondsOf(message.at), text: message.content })),
  ]
  // Array sort is stable, so a note and a message written in the same millisecond keep their order.
  return entries.sort((a, b) => a.at - b.at)
}
