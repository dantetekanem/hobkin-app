/**
 * How a review's preparation stands, and what a verdict will do, as the host tells the window.
 * See _specs/005-review-model and _specs/009-review-notes.
 */
import type { NoteEntry } from './notes.ts'
import type { Review } from './types.ts'
import type { PullReviewPost, Verdict } from './verdict.ts'

/**
 * Whether a review opens now. `ready`: one does, even while a newer one is prepared. `preparing`: none yet, and one is
 * on its way. `failed`: none could be prepared. `idle`: none, and nothing is under way.
 */
export type PrepareState = 'idle' | 'preparing' | 'ready' | 'failed'

/** What the preparation under way is doing: waiting its turn, reading the change, arranging its story with the agent, or checking the result. */
export type PreparePhase = 'queued' | 'reading' | 'arranging' | 'checking'

export interface ReviewStatus {
  id: string
  state: PrepareState
  /** Null when nothing is under way. */
  phase: PreparePhase | null
  /** The commit the change is at, when known. */
  head: string | null
  /** A review is ready, for an older commit than the change is at now. It opens, and a new one is on its way. */
  stale: boolean
  /** When the ready review was prepared, as an ISO time. */
  preparedAt: string | null
  /** Why the last preparation failed, in plain words. A ready review can carry one: the newer one could not be prepared. */
  error: string | null
  /** Who wrote the storyline: the agent with the change-review skill, or the host alone when no model was asked. */
  storyBy: 'agent' | 'host' | null
}

export interface ReviewNotes {
  entries: NoteEntry[]
  draft: { intent: 'comment' | 'question'; text: string; editing?: string } | null
}

export interface OpenedReview {
  review: Review
  notes: ReviewNotes
  status: ReviewStatus
}

/** Exactly what a verdict will do, shown before it is done. `confirm` must come back unchanged for it to go. */
export interface VerdictPreview {
  verdict: Verdict
  /** What will happen, in plain words, line by line. */
  lines: string[]
  /** For a pull request: the review GitHub will get. */
  post?: PullReviewPost
  /** For a finished hobkin change: the note hobkin's agent will get when changes are asked for. */
  note?: string
  confirm: string
}

export const IDLE_STATUS = (id: string): ReviewStatus => ({ id, state: 'idle', phase: null, head: null, stale: false, preparedAt: null, error: null, storyBy: null })
