/**
 * What a verdict sends. Built here, in one place, so the confirmation the reviewer reads is exactly what goes.
 * Comments are the reviewer's feedback for the change. Questions are for hobkin, and never go with a verdict.
 * See _specs/009-review-notes.
 */
import { agentMessage } from '../agent-message.ts'
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

/** The first line of everything posted to GitHub: the reader there sees the user's account, and this says who wrote it. */
const WRITTEN_BY = '**hobkin automated review**'

/**
 * A text as it is posted to GitHub: that hobkin wrote it, then its first paragraph on one line, then anything more
 * folded away under "See more", so a long review does not fill the pull request's page.
 */
function automated(text: string): string {
  const [first = '', ...rest] = text.trim().split(/\n\s*\n/)
  const more = rest.join('\n\n').trim()
  const folded = more ? ['', '<details>', '<summary>See more</summary>', '', more, '', '</details>'] : []
  return [WRITTEN_BY, '', first.replace(/\s*\n\s*/g, ' '), ...folded].join('\n')
}

/** The reviewer's words as the comment a pull request gets before it is closed unmerged, or null when they wrote none. */
export function closingComment(summary: string): string | null {
  const said = summary.trim()
  return said ? automated(said) : null
}

/** Whether a review has no words of the reviewer's and no comment: only what GitHub asks every review to carry. */
export const saysNothing = (post: PullReviewPost, version?: string | null) =>
  post.comments.length === 0 && Object.values(PLAIN).some((plain) => post.body === automated(plain) || post.body === agentMessage({ summary: plain, version }))

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
 * about written out. Human-owned content keeps its existing publication format. Agent findings remain visible;
 * only their source context is folded away. Notes arrive from core agents without job-version metadata, so their
 * version is explicitly unavailable, never borrowed from this client or a later core install.
 */
export function pullReviewPost(review: Review, notes: readonly Note[], verdict: PullVerdict, summary: string, detached: ReadonlySet<string> = new Set(), version?: string | null): PullReviewPost {
  const lines: PullReviewPost['comments'] = []
  const loose: string[] = []
  const agents: Note[] = []
  for (const note of inStoryOrder(review, comments(notes))) {
    const { target } = note
    if (target.kind === 'lines' && !detached.has(note.id)) {
      const path = review.files.find((file) => file.id === target.fileId)?.path ?? target.fileId
      const side = target.side === 'added' ? 'RIGHT' : 'LEFT'
      const body = note.author === 'hobkin'
        ? agentMessage({ summary: note.text, details: whereInWords(review, note) })
        : automated(note.text)
      lines.push({ path, side, ...(target.startLine < target.endLine ? { start_line: target.startLine, start_side: side } : {}), line: target.endLine, body })
      continue
    }
    if (note.author === 'hobkin') {
      agents.push(note)
      continue
    }
    const about = aboutOnly(review, note)
    loose.push(`- ${about ? `${about.replace(/\.$/, '')}: ` : ''}${note.text}`)
  }
  const said = summary.trim()
  const human = said || loose.length
    ? automated([said || PLAIN[verdict], loose.join('\n')].filter(Boolean).join('\n\n'))
    : ''
  const agent = agents.length
    ? agentMessage({
        summary: agents.map((note) => note.text).join('\n'),
        details: agents.map((note) => whereInWords(review, note)).join('\n\n'),
      })
    : ''
  const written = [human, agent].filter(Boolean).join('\n\n')
  const body = written || (version === undefined ? automated(PLAIN[verdict]) : agentMessage({ summary: PLAIN[verdict], version }))
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
