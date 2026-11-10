/**
 * Notes a reviewer takes while walking a change. See _specs/009-review-notes.
 *
 * A note is taken on a step, and is about that step or about something more particular the reviewer was
 * on: a node, a wire, or a few lines in the code panel. It is a comment, kept for the verdict, or a
 * question, to discuss with hobkin. Everything here is pure, and the host can keep the same log.
 */
import { hashLines } from '#shared/review/lines.ts'
import { WIRE_PHRASE, type AnchorSide, type Review } from '#shared/review/types.ts'

/** A comment is review feedback, kept for the verdict. A question is saved to discuss with hobkin. */
export type NoteIntent = 'comment' | 'question'

export type NoteTarget =
  | { kind: 'step' }
  | { kind: 'node'; node: string }
  | { kind: 'wire'; wire: string }
  /** Lines of one side of a file. The hash is of those lines when the note was taken. */
  | { kind: 'lines'; fileId: string; side: AnchorSide; startLine: number; endLine: number; hash: string }

export interface Note {
  id: string
  /** The id of the step the note was taken on. */
  step: string
  target: NoteTarget
  intent: NoteIntent
  text: string
  author: 'user' | 'hobkin'
  /** When it was written, in milliseconds. */
  at: number
  /** When it was handed to hobkin, for a question. */
  sent?: number
}

/** The notes are a log: a `put` adds a note or replaces the one with its id, and a `remove` drops it. */
export type NoteEntry = { op: 'put'; note: Note } | { op: 'remove'; id: string }

/** The notes a log adds up to, in the order they were first written. */
export function foldNotes(entries: readonly NoteEntry[]): Note[] {
  const notes = new Map<string, Note>()
  for (const entry of entries) {
    if (entry.op === 'remove') notes.delete(entry.id)
    else notes.set(entry.note.id, entry.note)
  }
  return [...notes.values()]
}

export interface NoteCounts {
  /** By step id: every note taken on that step, whatever it points at. */
  steps: Record<string, { comments: number; questions: number }>
  nodes: Record<string, number>
  wires: Record<string, number>
  lines: { fileId: string; side: AnchorSide; startLine: number; endLine: number; count: number }[]
  comments: number
  questions: number
}

/** How many notes each step, node, wire and line range has, for the markers they show. */
export function countNotes(notes: readonly Note[]): NoteCounts {
  const counts: NoteCounts = { steps: {}, nodes: {}, wires: {}, lines: [], comments: 0, questions: 0 }
  for (const note of notes) {
    const step = (counts.steps[note.step] ??= { comments: 0, questions: 0 })
    if (note.intent === 'question') {
      step.questions += 1
      counts.questions += 1
    } else {
      step.comments += 1
      counts.comments += 1
    }
    const { target } = note
    if (target.kind === 'node') counts.nodes[target.node] = (counts.nodes[target.node] ?? 0) + 1
    else if (target.kind === 'wire') counts.wires[target.wire] = (counts.wires[target.wire] ?? 0) + 1
    else if (target.kind === 'lines') {
      const same = counts.lines.find((range) => range.fileId === target.fileId && range.side === target.side && range.startLine === target.startLine && range.endLine === target.endLine)
      if (same) same.count += 1
      else counts.lines.push({ fileId: target.fileId, side: target.side, startLine: target.startLine, endLine: target.endLine, count: 1 })
    }
  }
  return counts
}

/** What the reviewer is on when a note is started. */
export interface NoteContext {
  step: string
  /** A node focused outside the story. */
  detour: string | null
  /** The wire whose card is open. */
  wire: string | null
  /** Lines selected in the code panel. */
  selection: Extract<NoteTarget, { kind: 'lines' }> | null
}

/** A new note is about the most particular thing the reviewer is on: selected lines, then an open wire, then a node off the path, then the step. */
export function noteTarget(context: NoteContext): NoteTarget {
  if (context.selection) return context.selection
  if (context.wire) return { kind: 'wire', wire: context.wire }
  if (context.detour) return { kind: 'node', node: context.detour }
  return { kind: 'step' }
}

const KIND_WORD = { criterion: 'an acceptance line', test: 'a test', code: 'code', file: 'a file', context: 'unchanged code' } as const

/** What a target is, in a few words, for the head of the note editor: "the step", "send", "lines 4 to 9". */
export function targetLabel(review: Review, target: NoteTarget): string {
  if (target.kind === 'step') return 'this step'
  if (target.kind === 'node') return review.nodes.find((node) => node.id === target.node)?.title ?? 'a node'
  if (target.kind === 'wire') {
    const edge = review.edges.find((entry) => entry.id === target.wire)
    const title = (id?: string) => review.nodes.find((node) => node.id === id)?.title ?? 'a node'
    return edge ? `the wire from ${title(edge.from)} to ${title(edge.to)}` : 'a wire'
  }
  return target.startLine === target.endLine ? `line ${target.startLine}` : `lines ${target.startLine} to ${target.endLine}`
}

/**
 * Where a note was taken and what it is about, in words, so the note can be read without the graph:
 * by hobkin in the conversation, and by a work agent in a request for changes.
 */
export function whereInWords(review: Review, note: Pick<Note, 'step' | 'target'>): string {
  const at = review.story.findIndex((step) => step.id === note.step)
  const step = at < 0 ? 'A step that is no longer in the story.' : `Step ${at + 1} of ${review.story.length}, "${review.story[at]!.title}".`
  const { target } = note
  if (target.kind === 'step') return step
  if (target.kind === 'node') {
    const node = review.nodes.find((entry) => entry.id === target.node)
    if (!node) return `${step} About a node that is no longer in the review.`
    return `${step} About ${node.title}, ${KIND_WORD[node.kind]}${node.subtitle ? ` in ${node.subtitle}` : ''}.`
  }
  if (target.kind === 'wire') {
    const edge = review.edges.find((entry) => entry.id === target.wire)
    const title = (id: string) => review.nodes.find((node) => node.id === id)?.title ?? 'a node'
    if (!edge) return `${step} About a wire that is no longer in the review.`
    return `${step} About the wire from ${title(edge.from)} to ${title(edge.to)}: ${title(edge.from)} ${WIRE_PHRASE[edge.kind]} ${title(edge.to)}.`
  }
  const path = review.files.find((file) => file.id === target.fileId)?.path ?? target.fileId
  const side = target.side === 'added' ? 'as changed' : 'as it was before the change'
  return `${step} About ${path}, ${targetLabel(review, target)}, ${side}.`
}

const NUMBER_WORD = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']

/**
 * The message that hands the reviewer's questions to hobkin: one message, the questions in the order of
 * the story, each with its step and target written out. Null when there is no question left to hand over.
 * Comments are not in it. They stay for the verdict.
 */
export function discussionMessage(review: Review, notes: readonly Note[]): string | null {
  const order = (note: Note) => {
    const at = review.story.findIndex((step) => step.id === note.step)
    return at < 0 ? review.story.length : at
  }
  const questions = notes.filter((note) => note.intent === 'question' && note.sent == null).sort((a, b) => order(a) - order(b) || a.at - b.at)
  if (questions.length === 0) return null
  const count = `${NUMBER_WORD[questions.length] ?? questions.length} ${questions.length === 1 ? 'question' : 'questions'}`
  const { change } = review
  const parts = [`${count} from my review of "${change.title}" (${change.project}, ${change.branch}, at ${change.head.slice(0, 7)}).`]
  questions.forEach((note, index) => {
    const text = note.text.split('\n').map((line) => `   ${line}`)
    parts.push('', `${index + 1}. ${whereInWords(review, note)}`, ...text)
  })
  return parts.join('\n')
}

/**
 * The ids of the notes whose lines are no longer what they were when the note was taken. Such a note is
 * kept and shown as detached, never dropped. `read` gives one side of a file, or null when it is gone.
 */
export function detached(notes: readonly Note[], read: (fileId: string, side: AnchorSide) => string | null): string[] {
  return notes
    .filter((note) => {
      if (note.target.kind !== 'lines') return false
      const text = read(note.target.fileId, note.target.side)
      return text == null || hashLines(text, note.target.startLine, note.target.endLine) !== note.target.hash
    })
    .map((note) => note.id)
}
