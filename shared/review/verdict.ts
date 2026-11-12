/**
 * What a verdict sends. Built here, in one place, so the confirmation the reviewer reads is exactly what goes.
 * Comments are the reviewer's feedback for the change. Questions are for hobkin, and never go with a verdict.
 * See _specs/009-review-notes.
 */
import { whereInWords, type Note } from './notes.ts'
import type { Review } from './types.ts'

/**
 * `approve` on a pull request is a GitHub review, and on a finished hobkin change the yes to open its pull request.
 * `approve-merge` lands a finished change as its card does, and merges a pull request through GitHub after approving
 * it (or, on the user's own, after the comments they wrote: GitHub lets nobody approve their own).
 */
export type Verdict = 'comment' | 'approve' | 'approve-merge' | 'request-changes'

/** The GitHub reviews a pull request can get here. Approve and merge posts one of them, then merges. */
export type PullVerdict = Exclude<Verdict, 'approve-merge'>

/** One GitHub review: `POST /repos/{owner}/{repo}/pulls/{number}/reviews`. */
export interface PullReviewPost {
  event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
  /** The commit the review was built from, so GitHub places the comments on the lines the reviewer saw. */
  commit_id: string
  body: string
  comments: { path: string; line: number; side: 'LEFT' | 'RIGHT'; start_line?: number; start_side?: 'LEFT' | 'RIGHT'; body: string }[]
}

const EVENT = { comment: 'COMMENT', approve: 'APPROVE', 'request-changes': 'REQUEST_CHANGES' } as const
const PLAIN = { comment: 'Commented.', approve: 'Approved.', 'request-changes': 'Changes requested.' } as const

/** The comments a verdict can send: not questions, and not anything already handed over. */
const comments = (notes: readonly Note[]) => notes.filter((note) => note.intent === 'comment' && note.sent == null)

/** In the order of the story, as the reviewer met them. */
function inStoryOrder(review: Review, notes: readonly Note[]): Note[] {
  const at = (note: Note) => {
    const index = review.story.findIndex((step) => step.id === note.step)
    return index < 0 ? review.story.length : index
  }
  return [...notes].sort((a, b) => at(a) - at(b) || a.at - b.at)
}

/** What a note is about, without the step: for a line in a pull request's body. */
const aboutOnly = (review: Review, note: Note) => whereInWords(review, note).replace(/^(?:Step \d+ of \d+, "[^"]*"\.|A step that is no longer in the story\.)\s*/, '')

/**
 * A pull request review: the comments on lines become line comments, and the rest go in its body with what each is
 * about written out. `detached` holds the notes whose lines have changed since, which go in the body instead.
 */
export function pullReviewPost(review: Review, notes: readonly Note[], verdict: PullVerdict, summary: string, detached: ReadonlySet<string> = new Set()): PullReviewPost {
  const lines: PullReviewPost['comments'] = []
  const loose: string[] = []
  for (const note of inStoryOrder(review, comments(notes))) {
    const { target } = note
    if (target.kind === 'lines' && !detached.has(note.id)) {
      const path = review.files.find((file) => file.id === target.fileId)?.path ?? target.fileId
      const side = target.side === 'added' ? 'RIGHT' : 'LEFT'
      lines.push({ path, side, ...(target.startLine < target.endLine ? { start_line: target.startLine, start_side: side } : {}), line: target.endLine, body: note.text })
      continue
    }
    const about = aboutOnly(review, note)
    loose.push(`- ${about ? `${about.replace(/\.$/, '')}: ` : ''}${note.text}`)
  }
  const said = summary.trim()
  const body = [...(said ? [said] : []), ...(loose.length && said ? [''] : []), ...loose].join('\n') || PLAIN[verdict]
  return { event: EVENT[verdict], commit_id: review.change.head, body, comments: lines }
}

/**
 * hobkin's "ask for changes" note: the reviewer's words, then each comment with its step and target written out, so
 * the work agent can act without the graph. Null when there is nothing to ask for.
 */
export function askForChanges(review: Review, notes: readonly Note[], summary: string): string | null {
  const asked = inStoryOrder(review, comments(notes))
  const said = summary.trim()
  if (asked.length === 0 && !said) return null
  const parts = said ? [said] : []
  asked.forEach((note, index) => {
    parts.push('', `${index + 1}. ${whereInWords(review, note)}`, ...note.text.split('\n').map((line) => `   ${line}`))
  })
  return parts.join('\n').replace(/^\n/, '')
}
