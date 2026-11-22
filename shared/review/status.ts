/**
 * How a review's preparation stands, and what a verdict will do, as the host tells the window.
 * See _specs/005-review-model and _specs/009-review-notes.
 */
import type { AssessmentStatus, ChangeAssessment } from './assessment.ts'
import type { NoteEntry, NoteIntent } from './notes.ts'
import type { NodeIO, NodeKind, NodeStatus, Review, ReviewPath } from './types.ts'
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
  /** While a preparation is queued or under way: when it was asked for, as an ISO time from the host's clock. */
  startedAt?: string
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
  /** Where hobkin last moved the reviewer's view: a step, by its number from 1, or a node. The window follows a newer one. */
  cursor?: ReviewCursor
  /** When hobkin last left a note, so the window fetches the notes again. */
  notesAt?: number
  /**
   * For a finished change, or a pull request the user asked to review: how its change review (spec 032) stands at the
   * commit the change is at.
   */
  assessment?: AssessmentStatus
  /** For a finished change the user said yes to: being brought up to date to merge, or merged. A state, never an error. */
  landing?: ReviewLanding
  /** A merge the user asked for that has not happened: still on its way, or refused. Gone once it merges. */
  mergeAsked?: MergeAsked
  /**
   * For a pull request whose review recorded it: who opened it, and whether it is the user's. Only the user's own is
   * merged or closed from here. A review prepared before this was recorded has none, and reads as someone else's.
   */
  owner?: PullOwner
}

/** A person a pull request names: their name, and their profile when it is known. */
export interface ReviewPerson {
  name: string
  url?: string
}

/** Who a pull request is from: its author, and who it is for when an agent opened it because they asked. */
export interface ReviewPeople {
  author: ReviewPerson | null
  for?: ReviewPerson
}

/** Whose a pull request is: its author as its host names them, and whether it is the user's own. */
export interface PullOwner {
  author: string | null
  mine: boolean
}

/**
 * A merge the user asked for, kept until it happens, so a yes that did not land is never lost from sight. `waiting`:
 * something runs first, as when its branch is brought up to date. `failed`: it was refused, and `why` is the reason given.
 */
export interface MergeAsked {
  /** When the user said merge, as an ISO time. */
  at: string
  state: 'waiting' | 'failed'
  why?: string
  /** For a merge a code host does in its own time: what it does once asked, in the code host file's words. */
  message?: string
  /** The confirmation the merge was asked with, so the same yes again asks nothing more. */
  confirm?: string
}

/**
 * Where a finished change stands after the user's yes. `refreshing`: an agent brings it up to date with its default
 * branch, and hobkin merges it once that run ends well; its head moving meanwhile is that, not a new change to review.
 * `merged`: it landed, as `sha`, into `into`.
 */
export interface ReviewLanding {
  state: 'refreshing' | 'merged'
  /** The commit it landed as. */
  sha?: string
  /** When the refresh was asked for, or when it merged, as an ISO time. */
  at?: string
  /** The branch it merges into. */
  into?: string
  /** What happened, in plain words. */
  message?: string
}

export interface ReviewCursor {
  step?: number
  node?: string
  /** When it was set, in milliseconds. */
  at: number
}

export interface ReviewNotes {
  entries: NoteEntry[]
  draft: { intent: 'comment' | 'question'; text: string; editing?: string } | null
}

export interface OpenedReview {
  review: Review
  notes: ReviewNotes
  status: ReviewStatus
  /** For a finished change or a pull request: its change review (spec 032), once one is ready for the review's commit; null until then. */
  assessment?: ChangeAssessment | null
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

/** A review as hobkin reads it: every node, wire, path and step, and its notes, without code ranges or hashes. */
export interface ReviewMap {
  id: string
  title: string
  summary: string
  /** The commit the review was built for. */
  head: string
  /** The change has moved on since. The review still opens, and a rebuild brings it up to date. */
  outdated: boolean
  notices: string[]
  nodes: { id: string; kind: NodeKind; title: string; path?: string; summary: string; io?: NodeIO; status?: NodeStatus; warning?: string }[]
  wires: { id: string; from: string; to: string; kind: string; label?: string; proposed?: true }[]
  paths: ReviewPath[]
  steps: { step: number; title: string; focus: string[]; path?: string }[]
  notes: { id: string; step: number; about: string; intent: NoteIntent; author: 'user' | 'hobkin'; text: string; sent: boolean }[]
}

/** The lines of one node, numbered, by the side of the change they are on. */
export interface ReviewCode {
  node: string
  title: string
  path?: string
  parts: { side: 'added' | 'deleted'; startLine: number; endLine: number; text: string }[]
}

/** One review the host knows, for the list of AI reviews: what it is about, how it stands, and when it last changed. */
export interface ReviewListItem {
  id: string
  kind: 'change' | 'pull'
  title: string
  /** The project, or `owner/repo` for a pull request. */
  project: string
  head: string | null
  state: PrepareState
  phase: PreparePhase | null
  /** While a preparation is queued or under way: when it was asked for, as an ISO time. */
  startedAt?: string
  error: string | null
  /** For a finished change or a pull request: how its change review stands, without its steps. */
  assessment?: AssessmentStatus
  /** A merge the user asked for that has not happened. */
  mergeAsked?: MergeAsked
  /** For a pull request whose review recorded it: who opened it, and whether it is the user's. */
  owner?: PullOwner
  /**
   * A finished change the background prepares when its turn comes: nothing has started at its commit yet, or what started
   * was cut short and starts again. A host older than this does not send it.
   */
  waiting?: true
  /** When any of it last changed, as an ISO time. */
  updatedAt: string
}

export interface ReviewList {
  /** Newest first. */
  reviews: ReviewListItem[]
}

/**
 * Whether the AI Reviews list shows a review as a row: something of it ran, runs or waits its turn, or a merge the user
 * asked for has not happened. One that is only known, as a review the user stopped before anything ran, is no row.
 */
export function shownAsRow(item: ReviewListItem): boolean {
  const assessment = item.assessment?.state
  return Boolean(item.mergeAsked || item.waiting) || item.state !== 'idle' || (assessment != null && assessment !== 'idle')
}

export const IDLE_STATUS = (id: string): ReviewStatus => ({ id, state: 'idle', phase: null, head: null, stale: false, preparedAt: null, error: null, storyBy: null })
