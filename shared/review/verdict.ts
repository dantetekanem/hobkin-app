/**
 * What a verdict sends. Built here, in one place, so the confirmation the reviewer reads is exactly what goes.
 * Comments are the reviewer's feedback for the change. Questions are for hobkin, and never go with a verdict. What a
 * pull request gets is the user's own words, as they wrote them: nothing automated goes with it.
 * See _specs/009-review-notes.
 */
import { whereInWords, type Note } from './notes.ts'
import type { Review } from './types.ts'

/**
 * `approve` on a pull request is a GitHub review, and on a finished hobkin change the yes to open its pull request.
 * `approve-merge` lands a finished change as its card does, and merges a pull request through GitHub after approving
 * it (or, on the user's own, after the comments they wrote: GitHub lets nobody approve their own).
 * `discard` is the no: a pull request is closed on GitHub without merging, and a finished change gets hobkin's own no,
 * with its pull request closed when one is open. No review is posted with it.
 * `discard-branch` is that no, and then the branch goes: a pull request's head branch on GitHub when it lives in the
 * repository it merges into, and a finished change's own branch on this Mac and on GitHub, with the worktree that holds it.
 */
export type Verdict = 'comment' | 'approve' | 'approve-merge' | 'request-changes' | 'discard' | 'discard-branch'

/** The GitHub reviews a pull request can get here. Approve and merge posts one of them, then merges. */
export type PullVerdict = Exclude<Verdict, 'approve-merge' | 'discard' | 'discard-branch'>

/**
 * One GitHub review: `POST /repos/{owner}/{repo}/pulls/{number}/reviews`. It carries only what the user wrote: with no
 * words of theirs it has no body, as an approval with nothing to say or a review of line comments alone.
 */
export interface PullReviewPost {
  event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
  /** The commit the review was built from, so GitHub places the comments on the lines the reviewer saw. */
  commit_id: string
  body?: string
  comments: { path: string; line: number; side: 'LEFT' | 'RIGHT'; start_line?: number; start_side?: 'LEFT' | 'RIGHT'; body: string }[]
}

const EVENT = { comment: 'COMMENT', approve: 'APPROVE', 'request-changes': 'REQUEST_CHANGES' } as const

/** The reviewer's words as the comment a pull request gets before it is closed unmerged, as written, or null when they wrote none. */
export function closingComment(summary: string): string | null {
  return summary.trim() || null
}

/** Whether a review has no words of the reviewer's and no comment on a line. */
export const saysNothing = (post: PullReviewPost) => post.comments.length === 0 && !post.body

/** The comments a verdict can send: not questions, and not anything already handed over. */
const comments = (notes: readonly Note[]) => notes.filter((note) => note.intent === 'comment' && note.sent == null)

/** The comments of the user's own that a pull request can get: hobkin's notes are for the user, and never go. */
export const usersComments = (notes: readonly Note[]) => comments(notes).filter((note) => note.author !== 'hobkin')

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
 * A pull request review, of the user's own words only, exactly as they wrote them: their notes on lines become line
 * comments, and their summary and their other notes go in its body, each note with what it is about. hobkin adds
 * nothing: no line saying who wrote it, no filler, and none of its own notes.
 */
export function pullReviewPost(review: Review, notes: readonly Note[], verdict: PullVerdict, summary: string, detached: ReadonlySet<string> = new Set()): PullReviewPost {
  const lines: PullReviewPost['comments'] = []
  const loose: string[] = []
  for (const note of inStoryOrder(review, usersComments(notes))) {
    const { target } = note
    if (target.kind === 'lines' && !detached.has(note.id)) {
      const path = review.files.find((file) => file.id === target.fileId)?.path ?? target.fileId
      const side = target.side === 'added' ? 'RIGHT' : 'LEFT'
      lines.push({ path, side, ...(target.startLine < target.endLine ? { start_line: target.startLine, start_side: side } : {}), line: target.endLine, body: note.text })
      continue
    }
    const about = aboutOnly(review, note)
    loose.push(`${about ? `${about.replace(/\.$/, '')}: ` : ''}${note.text}`)
  }
  const body = [summary.trim(), ...loose].filter(Boolean).join('\n\n')
  return { event: EVENT[verdict], commit_id: review.change.head, ...(body ? { body } : {}), comments: lines }
}

/** The user's questions not asked yet: what "Talk to agent" takes to discuss, as pi-coder's DISCUSS items. */
export const questionsToDiscuss = (notes: readonly Note[]) => notes.filter((note) => note.intent === 'question' && note.author !== 'hobkin' && note.sent == null)

const COMMENTS_HEADING = 'Comments: act on each one, or answer it when it asks something.'
const DISCUSS_HEADING = 'To discuss: answer these in words, and change no code for them.'

/**
 * What "Talk to agent" gives a finished change's agent: the reviewer's words, then each comment, then each question to
 * discuss, with its step and target written out, so the work agent can act without the graph. With questions, each
 * kind is named, as pi-coder names its COMMENT and DISCUSS items; comments alone go as they always have. The items are
 * numbered through, so the agent can answer one by its number. Null when there is nothing to send.
 */
export function askForChanges(review: Review, notes: readonly Note[], summary: string): string | null {
  const asked = inStoryOrder(review, comments(notes))
  const discussed = inStoryOrder(review, questionsToDiscuss(notes))
  const said = summary.trim()
  if (asked.length === 0 && discussed.length === 0 && !said) return null

  const parts = said ? [said] : []
  let number = 0
  const list = (items: readonly Note[]) => {
    for (const note of items) {
      number += 1
      parts.push('', `${number}. ${whereInWords(review, note)}`, ...note.text.split('\n').map((line) => `   ${line}`))
    }
  }
  const named = discussed.length > 0
  if (named && asked.length > 0) parts.push(...(said ? [''] : []), COMMENTS_HEADING)
  list(asked)
  if (named) parts.push(...(parts.length > 0 ? [''] : []), DISCUSS_HEADING)
  list(discussed)
  return parts.join('\n').replace(/^\n/, '')
}
