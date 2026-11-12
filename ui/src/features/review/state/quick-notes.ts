/**
 * The notes panel on the canvas (the user, 2026-11-12: "comments should open a panel near the node for quick read"):
 * the comments and questions written about one node, or taken on one step, read beside the node without leaving the
 * graph. Pure, so what it lists can be tested without drawing it.
 */
import type { ReviewAnchor, ReviewNode } from '#shared/review/types.ts'
import type { Note } from '../notes/notes.ts'

/** What the panel lists: the notes about a node, or the notes taken on a step, by the step's id. */
export type NotesShown = { kind: 'node'; node: string } | { kind: 'step'; step: string }

type Anchored = Pick<ReviewNode, 'id' | 'anchors'>

const within = (anchor: ReviewAnchor, target: Extract<Note['target'], { kind: 'lines' }>) =>
  anchor.fileId === target.fileId && anchor.side === target.side && anchor.startLine <= target.endLine && target.startLine <= anchor.endLine

/**
 * The notes about a node: those written on it, and those on lines of its code. `members` are the nodes it stands for,
 * as a card of folded tests stands for its tests, whose notes are its own too. Oldest first.
 */
export function notesAbout(notes: readonly Note[], node: Anchored, members: readonly Anchored[] = []): Note[] {
  const ids = new Set([node.id, ...members.map((member) => member.id)])
  const anchors = [node, ...members].flatMap((entry) => entry.anchors)
  return notes
    .filter(({ target }) => (target.kind === 'node' && ids.has(target.node)) || (target.kind === 'lines' && anchors.some((anchor) => within(anchor, target))))
    .sort((a, b) => a.at - b.at)
}

/** The notes taken on a step, whatever they point at. Oldest first. */
export function notesOnStep(notes: readonly Note[], step: string): Note[] {
  return notes.filter((note) => note.step === step).sort((a, b) => a.at - b.at)
}

/** Who wrote a note and what it is, in the panel's words: "You · Comment", "Hobkin · Question". */
export function noteByline(note: Pick<Note, 'author' | 'intent'>): string {
  return `${note.author === 'hobkin' ? 'Hobkin' : 'You'} · ${note.intent === 'question' ? 'Question' : 'Comment'}`
}

/** Whether a note has gone anywhere: a question handed to hobkin, a comment sent with a verdict, or neither yet. */
export function sentWords(note: Pick<Note, 'intent' | 'sent'>): string {
  if (note.sent == null) return 'Not sent yet'
  return note.intent === 'question' ? 'Asked Hobkin' : 'Sent'
}
